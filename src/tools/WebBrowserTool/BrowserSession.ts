import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { logForDebugging } from '../../utils/debug.js'
import type { BrowserMode, SessionState } from './types.js'

// Global singleton registry for browser sessions
const sessions = new Map<string, {
  browser: Browser
  context: BrowserContext
  page: Page
  state: SessionState
}>()

/**
 * Get or create a browser session
 */
export async function getOrCreateSession(
  sessionId: string,
  mode: BrowserMode = 'headless'
): Promise<{ page: Page, state: SessionState }> {
  let session = sessions.get(sessionId)

  if (!session) {
    logForDebugging(`Creating new browser session: ${sessionId}`)
    const browser = await chromium.launch({
      headless: mode === 'headless',
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()

    session = {
      browser,
      context,
      page,
      state: {
        sessionId,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        url: '',
        title: '',
      },
    }
    sessions.set(sessionId, session)
  } else {
    session.state.lastAccessedAt = Date.now()
  }

  return { page: session.page, state: session.state }
}

/**
 * Update session state after an action
 */
export function updateSessionState(sessionId: string, url: string, title: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.state.url = url
    session.state.title = title
  }
}

/**
 * Close a specific session
 */
export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (session) {
    logForDebugging(`Closing browser session: ${sessionId}`)
    await session.page.close()
    await session.context.close()
    await session.browser.close()
    sessions.delete(sessionId)
  }
}

/**
 * Close all sessions
 */
export async function closeAllSessions(): Promise<void> {
  logForDebugging(`Closing all browser sessions (count: ${sessions.size})`)
  for (const [sessionId] of sessions) {
    await closeSession(sessionId)
  }
}

/**
 * Get current session state
 */
export function getSessionState(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId)?.state
}

/**
 * List all active sessions
 */
export function listSessions(): SessionState[] {
  return Array.from(sessions.values()).map(s => s.state)
}