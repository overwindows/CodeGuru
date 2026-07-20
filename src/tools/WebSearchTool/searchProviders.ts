/**
 * Pluggable web search providers.
 *
 * Based on Hermes Agent's search provider model.
 * Supports: Bing (default), Firecrawl, Tavily, Exa, Parallel
 */

import axios from 'axios'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

export type SearchHit = {
  title: string
  url: string
  snippet?: string
}

export type SearchResult = {
  summary: string
  hits: SearchHit[]
  provider: string
}

// ============================================================================
// Provider interface
// ============================================================================

export interface SearchProvider {
  readonly name: string
  search(query: string, signal?: AbortSignal): Promise<SearchResult>
}

// ============================================================================
// Bing (default - browser + RSS fallback)
// ============================================================================

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/\s+/g, ' ')
    .trim()
}

function tagValue(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  return m ? decodeXmlEntities(m[1]) : undefined
}

function parseBingRss(xml: string): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  const itemRe = /<item>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1]
    const title = tagValue(block, 'title')
    const url = tagValue(block, 'link')
    const snippet = tagValue(block, 'description')
    if (!title || !url) continue
    if (!/^https?:\/\//i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    hits.push({ title, url, snippet })
    if (hits.length >= 10) break
  }
  return hits
}

async function searchWithBrowser(
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const { chromium } = await import('playwright')

  if (signal?.aborted) {
    throw new Error('Bing browser search aborted')
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
    })
    const page = await context.newPage()

    const onAbort = () => {
      void page.close().catch(() => {})
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`
    logForDebugging(`Bing browser search: ${searchUrl}`)
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    await page
      .waitForSelector('li.b_algo h2 a', { timeout: 10_000 })
      .catch(() => undefined)

    const hits = await page.evaluate(() => {
      const out: Array<{ title: string; url: string; snippet?: string }> = []
      const seen = new Set<string>()

      function unwrapBingRedirect(href: string): string {
        try {
          const u = new URL(href, location.origin)
          if (u.hostname.includes('bing.com') && u.pathname === '/ck/a') {
            const raw = u.searchParams.get('u')
            if (raw) {
              let payload = raw.startsWith('a1') ? raw.slice(2) : raw
              payload = payload.replace(/-/g, '+').replace(/_/g, '/')
              while (payload.length % 4) payload += '='
              try {
                const decoded = atob(payload)
                if (decoded.startsWith('http')) return decoded
              } catch {
                // ignore
              }
            }
          }
          return u.href.startsWith('http') ? u.href : href
        } catch {
          return href
        }
      }

      const items = Array.from(document.querySelectorAll('li.b_algo'))
      for (const li of items) {
        const a = li.querySelector('h2 a') as HTMLAnchorElement | null
        if (!a?.href || !a.textContent) continue
        const url = unwrapBingRedirect(a.href)
        const title = a.textContent.trim()
        if (!url.startsWith('http') || !title) continue
        if (seen.has(url)) continue
        seen.add(url)
        const snipEl =
          li.querySelector('p') ||
          li.querySelector('.b_caption p') ||
          li.querySelector('.b_lineclamp')
        const snippet = snipEl?.textContent?.trim() || undefined
        out.push({ title, url, snippet })
        if (out.length >= 10) break
      }
      return out
    })

    signal?.removeEventListener('abort', onAbort)
    await context.close()
    return hits
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function searchWithRss(
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US&format=rss`
  const response = await axios.get<string>(rssUrl, {
    signal,
    timeout: 30_000,
    responseType: 'text',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    validateStatus: () => true,
    maxRedirects: 5,
  })
  if (response.status >= 400) {
    throw new Error(`Bing RSS search failed with HTTP ${response.status}`)
  }
  const body =
    typeof response.data === 'string' ? response.data : String(response.data)
  return parseBingRss(body)
}

function formatResult(query: string, hits: SearchHit[]): SearchResult {
  const lines = hits.map((h, i) => {
    const snip = h.snippet ? ` — ${h.snippet}` : ''
    return `${i + 1}. ${h.title}\n   ${h.url}${snip}`
  })
  return {
    summary: `Search results for "${query}":\n\n${lines.join('\n\n')}`,
    hits: hits.map(({ title, url }) => ({ title, url })),
    provider: 'bing',
  }
}

/**
 * Bing search provider - uses browser automation with RSS fallback.
 */
export class BingSearchProvider implements SearchProvider {
  readonly name = 'bing'

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    let hits: SearchHit[] = []
    let browserError: unknown

    try {
      hits = await searchWithBrowser(query, signal)
    } catch (e) {
      browserError = e
      logForDebugging(
        `Bing browser search failed, falling back to RSS: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    if (hits.length === 0) {
      try {
        hits = await searchWithRss(query, signal)
      } catch (rssError) {
        const browserMsg =
          browserError instanceof Error
            ? browserError.message
            : String(browserError ?? 'unknown')
        const rssMsg =
          rssError instanceof Error ? rssError.message : String(rssError)
        throw new Error(
          `Bing search failed via browser (${browserMsg}) and RSS (${rssMsg}). ` +
            `Install Playwright Chromium with: bunx playwright install chromium`,
        )
      }
    }

    if (hits.length === 0) {
      throw new Error('Bing returned no results.')
    }

    return formatResult(query, hits)
  }
}

// ============================================================================
// Firecrawl
// ============================================================================

/**
 * Firecrawl search provider.
 * Requires FIRECRAWL_API_KEY environment variable.
 */
export class FirecrawlSearchProvider implements SearchProvider {
  readonly name = 'firecrawl'

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY not set')
    }

    const response = await axios.post(
      'https://api.firecrawl.dev/v0/search',
      {
        query,
        limit: 10,
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
    const hits: SearchHit[] = (data.data || []).map((item: any) => ({
      title: item.title || 'Untitled',
      url: item.url,
      snippet: item.description || item.excerpt || undefined,
    }))

    return {
      summary: `Search results for "${query}" (via Firecrawl):\n\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n\n')}`,
      hits: hits.map(({ title, url }) => ({ title, url })),
      provider: 'firecrawl',
    }
  }
}

// ============================================================================
// Tavily
// ============================================================================

/**
 * Tavily search provider.
 * Requires TAVILY_API_KEY environment variable.
 */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily'

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY not set')
    }

    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        query,
        search_depth: 'basic',
        max_results: 10,
        include_answer: false,
        include_raw_content: false,
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
    const hits: SearchHit[] = (data.results || []).map((item: any) => ({
      title: item.title || 'Untitled',
      url: item.url,
      snippet: item.content || undefined,
    }))

    return {
      summary: `Search results for "${query}" (via Tavily):\n\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n\n')}`,
      hits: hits.map(({ title, url }) => ({ title, url })),
      provider: 'tavily',
    }
  }
}

// ============================================================================
// Exa
// ============================================================================

/**
 * Exa search provider.
 * Requires EXA_API_KEY environment variable.
 */
export class ExaSearchProvider implements SearchProvider {
  readonly name = 'exa'

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) {
      throw new Error('EXA_API_KEY not set')
    }

    const response = await axios.post(
      'https://api.exa.ai/search',
      {
        query,
        num_results: 10,
        type: 'auto',
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
    const hits: SearchHit[] = (data.results || []).map((item: any) => ({
      title: item.title || 'Untitled',
      url: item.url,
      snippet: item.snippet || item.description || undefined,
    }))

    return {
      summary: `Search results for "${query}" (via Exa):\n\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n\n')}`,
      hits: hits.map(({ title, url }) => ({ title, url })),
      provider: 'exa',
    }
  }
}

// ============================================================================
// Parallel
// ============================================================================

/**
 * Parallel search provider.
 * Requires PARALLEL_API_KEY environment variable.
 */
export class ParallelSearchProvider implements SearchProvider {
  readonly name = 'parallel'

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const apiKey = process.env.PARALLEL_API_KEY
    if (!apiKey) {
      throw new Error('PARALLEL_API_KEY not set')
    }

    const response = await axios.post(
      'https://api.parallel.xyz/v1/search',
      {
        query,
        limit: 10,
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
    const hits: SearchHit[] = (data.results || []).map((item: any) => ({
      title: item.title || 'Untitled',
      url: item.url,
      snippet: item.snippet || undefined,
    }))

    return {
      summary: `Search results for "${query}" (via Parallel):\n\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? ` — ${h.snippet}` : ''}`).join('\n\n')}`,
      hits: hits.map(({ title, url }) => ({ title, url })),
      provider: 'parallel',
    }
  }
}

// ============================================================================
// Provider selection
// ============================================================================

const SEARCH_PROVIDER_ORDER = [
  'firecrawl',
  'tavily',
  'exa',
  'parallel',
  'bing',
] as const

type ProviderName = (typeof SEARCH_PROVIDER_ORDER)[number]

function getProviderFromEnv(): ProviderName {
  // Check each provider in priority order
  for (const provider of SEARCH_PROVIDER_ORDER) {
    const envKey = {
      firecrawl: 'FIRECRAWL_API_KEY',
      tavily: 'TAVILY_API_KEY',
      exa: 'EXA_API_KEY',
      parallel: 'PARALLEL_API_KEY',
      bing: 'BING_API_KEY', // Not used but keeps the order
    }[provider]

    if (isEnvTruthy(process.env[envKey])) {
      return provider
    }
  }
  return 'bing' // Default to Bing
}

function createProvider(name: ProviderName): SearchProvider {
  switch (name) {
    case 'firecrawl':
      return new FirecrawlSearchProvider()
    case 'tavily':
      return new TavilySearchProvider()
    case 'exa':
      return new ExaSearchProvider()
    case 'parallel':
      return new ParallelSearchProvider()
    case 'bing':
    default:
      return new BingSearchProvider()
  }
}

let cachedProvider: SearchProvider | null = null

/**
 * Get the active search provider based on environment variables.
 * Uses the first available provider in priority order: Firecrawl > Tavily > Exa > Parallel > Bing
 */
export function getSearchProvider(): SearchProvider {
  if (!cachedProvider) {
    const providerName = getProviderFromEnv()
    cachedProvider = createProvider(providerName)
    logForDebugging(`[SearchProvider] Using provider: ${providerName}`)
  }
  return cachedProvider
}

/**
 * Search using the active provider.
 */
export async function searchWithProvider(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const provider = getSearchProvider()
  return provider.search(query, signal)
}

/**
 * Get the name of the currently active search provider.
 */
export function getActiveProviderName(): string {
  if (!cachedProvider) {
    return getProviderFromEnv()
  }
  return cachedProvider.name
}