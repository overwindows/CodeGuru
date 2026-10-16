import axios from 'axios'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { DESCRIPTION, WEB_EXTRACT_TOOL_NAME } from './prompt.js'
import { getToolUseSummary } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to extract content from'),
    prompt: z
      .string()
      .optional()
      .default('Extract all main content from this page')
      .describe('Prompt to guide what content to extract'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    content: z.string().describe('Extracted content from the URL'),
    title: z.string().optional().describe('Title of the page if available'),
    description: z.string().optional().describe('Description/summary if available'),
    author: z.string().optional().describe('Author if available'),
    publishedDate: z.string().optional().describe('Published date if available'),
    url: z.string().describe('The URL that was fetched'),
    durationMs: z
      .number()
      .describe('Time taken to extract the content'),
    provider: z.string().describe('Provider used for extraction (firecrawl, fetch)'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// ============================================================================
// Firecrawl extraction
// ============================================================================

interface FirecrawlResponse {
  success: boolean
  data?: {
    title?: string
    description?: string
    author?: string
    published_date?: string
    content?: string
  }
  error?: string
}

async function extractWithFirecrawl(
  url: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Output> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY not set')
  }

  const startTime = Date.now()

  const response = await axios.post<FirecrawlResponse>(
    'https://api.firecrawl.dev/v0/scrape',
    {
      url,
      prompt,
      pageOptions: {
        onlyMainContent: true,
      },
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      timeout: 30_000,
    },
  )

  const data = response.data
  if (!data.success || !data.data) {
    throw new Error(data.error || 'Firecrawl extraction failed')
  }

  return {
    content: data.data.content || '',
    title: data.data.title,
    description: data.data.description,
    author: data.data.author,
    publishedDate: data.data.published_date,
    url,
    durationMs: Date.now() - startTime,
    provider: 'firecrawl',
  }
}

// ============================================================================
// Fallback: simple fetch + prompt extraction
// ============================================================================

async function extractWithFetch(
  url: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Output> {
  const startTime = Date.now()

  const response = await axios.get<string>(url, {
    signal,
    timeout: 30_000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 5,
    responseType: 'text',
  })

  // Basic HTML stripping
  let content = response.data
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Try to extract title
  const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : undefined

  // Try to extract meta description
  const descMatch = response.data.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  )
  const description = descMatch ? descMatch[1].trim() : undefined

  // For now, return the raw content. A more sophisticated implementation
  // would use an LLM to extract based on the prompt.
  const resultContent = prompt
    ? `Extracted content (prompt: "${prompt}"):\n\n${content}`
    : content

  return {
    content: resultContent,
    title,
    description,
    url,
    durationMs: Date.now() - startTime,
    provider: 'fetch',
  }
}

// ============================================================================
// Tool definition
// ============================================================================

function webExtractToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = inputSchema().safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const WebExtractTool = buildTool({
  name: WEB_EXTRACT_TOOL_NAME,
  searchHint: 'extract structured content from a URL or PDF',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input: { url: string }) {
    const { url } = input
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to extract content from ${hostname}`
    } catch {
      return `Claude wants to extract content from this URL`
    }
  },
  userFacingName() {
    return 'Extract'
  },
  getToolUseSummary(input: Partial<{ url: string; prompt: string }>) {
    const { url, prompt } = input ?? {}
    return url ? (prompt ? `${url}: ${prompt}` : url) : null
  },
  getActivityDescription(input: Partial<{ url: string; prompt: string }>) {
    const summary = getToolUseSummary(input ?? {})
    return summary ? `Extracting from ${summary}` : 'Extracting web content'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input: { url: string; prompt?: string }) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
  async checkPermissions(input: { url: string }, context: { getAppState: () => { toolPermissionContext: unknown } }): Promise<PermissionResult> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    const ruleContent = webExtractToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebExtractTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny' as const,
        message: `${WebExtractTool.name} denied access to ${ruleContent}.`,
        decisionReason: {
          type: 'rule' as const,
          rule: denyRule,
        },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      WebExtractTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `${WebExtractTool.name} requires permission to access ${ruleContent}.`,
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: WEB_EXTRACT_TOOL_NAME, ruleContent }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebExtractTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return { behavior: 'allow' }
    }

    return {
      behavior: 'ask',
      message: `${WebExtractTool.name} requires permission to access ${ruleContent}.`,
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: WEB_EXTRACT_TOOL_NAME, ruleContent }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input: { url: string }) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async call({ url, prompt }: { url: string; prompt?: string }, { abortController }: { abortController: AbortController }) {
    logForDebugging(`[WebExtractTool] Extracting from: ${url}`)

    // Try Firecrawl first if API key is available
    if (isEnvTruthy(process.env.FIRECRAWL_API_KEY)) {
      try {
        const result = await extractWithFirecrawl(
          url,
          prompt ?? 'Extract all main content from this page',
          abortController.signal,
        )
        logForDebugging(
          `[WebExtractTool] Firecrawl extraction successful: ${result.title || url}`,
        )
        return { data: result }
      } catch (e) {
        logForDebugging(
          `Firecrawl extraction failed, falling back to fetch: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    // Fallback to simple fetch
    const result = await extractWithFetch(url, prompt ?? 'Extract all main content from this page', abortController.signal)
    logForDebugging(
      `[WebExtractTool] Fetch extraction successful: ${result.title || url}`,
    )
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string) {
    const { content, title, provider } = output
    const prefix = provider === 'firecrawl' ? '[Firecrawl] ' : '[Fetch] '
    const titleLine = title ? `${prefix}Title: ${title}\n\n` : ''
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${titleLine}${content}`,
    }
  },
} as unknown as ToolDef<InputSchema, Output>)