/**
 * Client-side web search via Bing using the browser tool (Playwright).
 * Opens www.bing.com in a headless Chromium session and extracts results.
 * Falls back to Bing RSS if Playwright/Chromium is unavailable.
 */

import axios from 'axios'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

export type BingSearchHit = {
  title: string
  url: string
  snippet?: string
}

export type BingSearchResult = {
  summary: string
  hits: BingSearchHit[]
}

export function isBingSearchEnabled(): boolean {
  if (isEnvTruthy(process.env.CODEGURU_DISABLE_BING_SEARCH)) {
    return false
  }
  return true
}

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

function parseBingRss(xml: string): BingSearchHit[] {
  const hits: BingSearchHit[] = []
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

function formatResult(query: string, hits: BingSearchHit[]): BingSearchResult {
  const lines = hits.map((h, i) => {
    const snip = h.snippet ? ` — ${h.snippet}` : ''
    return `${i + 1}. ${h.title}\n   ${h.url}${snip}`
  })
  return {
    summary: `Bing search results for "${query}":\n\n${lines.join('\n\n')}`,
    hits: hits.map(({ title, url }) => ({ title, url })),
  }
}

/**
 * Prefer browser automation: navigate Bing and scrape organic results.
 */
async function searchWithBrowser(
  query: string,
  signal?: AbortSignal,
): Promise<BingSearchHit[]> {
  // Dynamic import so missing playwright doesn't break non-browser runs at load time.
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

    // Wait for organic results if present; don't fail hard if layout differs.
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
              // Bing uses URL-safe base64
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
): Promise<BingSearchHit[]> {
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

export async function searchWithBing(
  query: string,
  signal?: AbortSignal,
): Promise<BingSearchResult> {
  let hits: BingSearchHit[] = []
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
    throw new Error(
      'Bing returned no results. Try again, or run: bunx playwright install chromium',
    )
  }

  return formatResult(query, hits)
}
