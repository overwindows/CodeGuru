import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type { WebBrowserProgress } from './types.js'
import { ActionSchema, BrowserModeSchema } from './types.js'
import { executeAction, executeActions } from './executeAction.js'
import {
  closeAllSessions,
  getOrCreateSession,
  listSessions,
  updateSessionState,
} from './BrowserSession.js'
import { runAgenticBrowser } from './AgenticBrowserService.js'
import { DESCRIPTION } from './prompt.js'
import { WEB_BROWSER_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task: z.string().optional().describe('High-level task for agentic mode (e.g., "Book a flight from NYC to LAX")'),
    goal: z.string().optional().describe('Success criteria for agentic mode'),
    actions: z.array(ActionSchema).optional().describe('Explicit action sequence for primitive mode'),
    sessionId: z.string().optional().describe('Session ID to resume a prior browser session'),
    maxSteps: z.number().optional().default(20).describe('Maximum number of actions in agentic mode'),
    browserMode: BrowserModeSchema.optional().default('headless').describe('Browser mode: headless or headed'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    message: z.string().describe('Result message'),
    sessionId: z.string().describe('Session ID used for this operation'),
    screenshot: z.string().optional().describe('Base64 screenshot if captured'),
    actionsCompleted: z.number().optional().describe('Number of actions completed'),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Re-export progress type for tool
export type { WebBrowserProgress } from './types.js'

function getToolUseSummary(input: Input): string | null {
  if (input.task) {
    return input.task
  }
  if (input.actions && input.actions.length > 0) {
    return input.actions.map(a => a.action).join(' → ')
  }
  return null
}

function getActivityDescription(input: Input): string {
  if (input.task) {
    return `Browser task: ${input.task}`
  }
  if (input.actions && input.actions.length > 0) {
    return `Browser: ${input.actions.length} action(s)`
  }
  return 'Browser control'
}

export const WebBrowserTool = buildTool({
  name: WEB_BROWSER_TOOL_NAME,
  searchHint: 'control a web browser to perform tasks like navigating, clicking, typing',
  maxResultSizeChars: 500_000,
  shouldDefer: true,
  getToolUseSummary,
  getActivityDescription,
  isEnabled() {
    // Enabled by default, can be disabled via environment variable
    return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_WEB_BROWSER_TOOL)
  },
  interruptBehavior: 'cancel',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false // Browser sessions are not concurrency safe
  },
  isReadOnly() {
    return false // Can modify web content
  },
  async prompt() {
    return DESCRIPTION
  },
  async description(input) {
    if (input.task) {
      return `Browser task: ${input.task}`
    }
    if (input.actions) {
      return `Browser: ${input.actions.map(a => a.action).join(', ')}`
    }
    return 'Control a web browser'
  },
  renderToolUseMessage({ input }) {
    if (input.task) {
      return `🌐 Browser: ${input.task}`
    }
    if (input.actions) {
      return `🌐 Browser: ${input.actions.map(a => a.action).join(' → ')}`
    }
    return '🌐 Browser control'
  },
  async call(input: Input, context, _canUseTool, _parentMessage, onProgress) {
    const sessionId = input.sessionId || `session-${Date.now()}`
    const browserMode = input.browserMode || 'headless'

    logForDebugging(`WebBrowserTool: session=${sessionId}, mode=${browserMode}`)

    try {
      // Get or create session
      const { page, state } = await getOrCreateSession(sessionId, browserMode)

      // Handle agentic mode (task-based)
      if (input.task) {
        const result = await runAgenticBrowser(page, {
          task: input.task,
          goal: input.goal,
          maxSteps: input.maxSteps || 20,
          onProgress: (progress: WebBrowserProgress) => {
            if (progress.type === 'screenshot' && onProgress) {
              onProgress({
                toolUseID: sessionId,
                data: { type: 'screenshot', data: progress.data },
              })
            }
          },
        })

        // Update session state
        updateSessionState(sessionId, page.url(), await page.title())

        return {
          data: {
            success: result.success,
            message: result.result,
            sessionId,
            actionsCompleted: input.maxSteps || 20,
          },
        }
      }

      // Handle primitive mode (explicit actions)
      if (input.actions && input.actions.length > 0) {
        let lastScreenshot: string | undefined

        const results = await executeActions(
          page,
          input.actions,
          (action, result) => {
            if (result.screenshot) {
              lastScreenshot = result.screenshot
            }
            if (onProgress) {
              onProgress({
                toolUseID: sessionId,
                data: {
                  type: result.success ? 'action_complete' : 'error',
                  action: action.action,
                  result: result.result || result.error,
                },
              })
            }
          },
        )

        // Update session state
        updateSessionState(sessionId, page.url(), await page.title())

        const allSucceeded = results.every(r => r.success)
        const failureIndex = results.findIndex(r => !r.success)

        return {
          data: {
            success: allSucceeded,
            message: allSucceeded
              ? `Completed ${results.length} action(s)`
              : `Failed at action ${failureIndex + 1}: ${results[failureIndex]?.error}`,
            sessionId,
            screenshot: lastScreenshot,
            actionsCompleted: allSucceeded ? results.length : failureIndex,
          },
        }
      }

      // No task or actions provided - just return session info
      const currentUrl = page.url()
      const currentTitle = await page.title()

      return {
        data: {
          success: true,
          message: `Active session: ${currentTitle || 'Untitled'} at ${currentUrl}`,
          sessionId,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`WebBrowserTool error: ${message}`)

      return {
        data: {
          success: false,
          message: `Error: ${message}`,
          sessionId,
        },
      }
    }
  },
  async onUnload() {
    // Clean up all browser sessions when tool is unloaded
    await closeAllSessions()
  },
} satisfies ToolDef<InputSchema, Output, WebBrowserProgress>)

// Register cleanup on process exit
process.on('beforeExit', () => {
  closeAllSessions().catch(() => {})
})