import axios from 'axios'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { DESCRIPTION, X_SEARCH_TOOL_NAME } from './prompt.js'
import { getToolUseSummary } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query for X/Twitter'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe('Maximum number of results to return'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    tweets: z
      .array(
        z.object({
          id: z.string().describe('Tweet ID'),
          text: z.string().describe('Tweet text content'),
          author: z
            .object({
              username: z.string().describe('Author username'),
              name: z.string().describe('Author display name'),
            })
            .describe('Author information'),
          created_at: z
            .string()
            .describe('Timestamp when tweet was created'),
          metrics: z
            .object({
              retweets: z.number().describe('Retweet count'),
              likes: z.number().describe('Like count'),
              replies: z.number().describe('Reply count'),
            })
            .optional()
            .describe('Tweet metrics'),
          url: z.string().describe('URL to the tweet'),
        }),
      )
      .describe('Array of matching tweets'),
    query: z.string().describe('The search query that was executed'),
    total_results: z
      .number()
      .describe('Total number of results found'),
    durationMs: z
      .number()
      .describe('Time taken to complete the search'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// ============================================================================
// xAI API search
// ============================================================================

interface XAITweet {
  id: string
  text: string
  author: {
    username: string
    name: string
  }
  created_at: string
  retweets?: number
  likes?: number
  replies?: number
  url?: string
}

interface XAISearchResponse {
  data?: {
    tweets?: XAITweet[]
    total?: number
  }
  error?: string
}

async function searchWithXAI(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<Output> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new Error('XAI_API_KEY not set')
  }

  const startTime = Date.now()

  const response = await axios.post<XAISearchResponse>(
    'https://api.x.ai/v1/search/tweets',
    {
      query,
      max_results: maxResults,
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
  if (data.error) {
    throw new Error(data.error)
  }

  const tweets = (data.data?.tweets || []).map(tweet => ({
    id: tweet.id,
    text: tweet.text,
    author: tweet.author,
    created_at: tweet.created_at,
    metrics: tweet.retweets !== undefined || tweet.likes !== undefined
      ? {
          retweets: tweet.retweets || 0,
          likes: tweet.likes || 0,
          replies: tweet.replies || 0,
        }
      : undefined,
    url: tweet.url || `https://x.com/${tweet.author.username}/status/${tweet.id}`,
  }))

  return {
    tweets,
    query,
    total_results: data.data?.total || tweets.length,
    durationMs: Date.now() - startTime,
  }
}

// ============================================================================
// Tool definition
// ============================================================================

function xSearchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = inputSchema().safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { query } = parsedInput.data
    return `query:${query}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const XSearchTool = buildTool({
  name: X_SEARCH_TOOL_NAME,
  searchHint: 'search Twitter/X for posts and tweets',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input: { query: string }) {
    const { query } = input
    return `Claude wants to search X/Twitter for: "${query}"`
  },
  userFacingName() {
    return 'X Search'
  },
  getToolUseSummary(input: Partial<{ query: string }>) {
    const { query } = input ?? {}
    return query ? `"${query}"` : null
  },
  getActivityDescription(input: Partial<{ query: string }>) {
    const summary = getToolUseSummary(input ?? {})
    return summary ? `Searching X for ${summary}` : 'Searching X/Twitter'
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
  toAutoClassifierInput(input: { query: string }) {
    return input.query
  },
  async checkPermissions(input: { query: string }, context: { getAppState: () => { toolPermissionContext: unknown } }): Promise<PermissionResult> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    const ruleContent = xSearchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      XSearchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny' as const,
        message: `${XSearchTool.name} denied for ${ruleContent}.`,
        decisionReason: {
          type: 'rule' as const,
          rule: denyRule,
        },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      XSearchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `${XSearchTool.name} requires permission for ${ruleContent}.`,
        suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: X_SEARCH_TOOL_NAME, ruleContent }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      XSearchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return { behavior: 'allow' }
    }

    return {
      behavior: 'ask',
      message: `${XSearchTool.name} requires permission for ${ruleContent}.`,
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: X_SEARCH_TOOL_NAME, ruleContent }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input: { query: string; max_results?: number }) {
    const { query } = input
    if (!query || query.length < 2) {
      return {
        result: false,
        message: 'Error: Query must be at least 2 characters',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async call({ query, max_results }: { query: string; max_results?: number }, { abortController }: { abortController: AbortController }) {
    logForDebugging(`[XSearchTool] Searching for: ${query}`)

    if (!isEnvTruthy(process.env.XAI_API_KEY)) {
      return {
        data: {
          tweets: [],
          query,
          total_results: 0,
          durationMs: 0,
        },
      }
    }

    try {
      const result = await searchWithXAI(
        query,
        max_results ?? 10,
        abortController.signal,
      )
      logForDebugging(
        `[XSearchTool] Found ${result.total_results} results for "${query}"`,
      )
      return { data: result }
    } catch (e) {
      logForDebugging(
        `X search failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      // Return empty results on error (x_search is best-effort)
      return {
        data: {
          tweets: [],
          query,
          total_results: 0,
          durationMs: 0,
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string) {
    const { tweets, query, total_results } = output
    if (tweets.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `No tweets found for query: "${query}"`,
      }
    }

    const lines = tweets.map((tweet, i) => {
      const metrics = tweet.metrics
        ? ` | ${tweet.metrics.retweets} RT, ${tweet.metrics.likes} likes`
        : ''
      return `${i + 1}. @${tweet.author.username}: ${tweet.text}\n   ${tweet.url}${metrics}`
    })

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `X/Twitter search results for "${query}" (${total_results} total):\n\n${lines.join('\n\n')}`,
    }
  },
} as unknown as ToolDef<InputSchema, Output>)