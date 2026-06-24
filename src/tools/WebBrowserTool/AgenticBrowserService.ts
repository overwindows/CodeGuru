import type { Page } from 'playwright'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { logForDebugging } from '../../utils/debug.js'
import { createUserMessage } from '../../utils/messages.js'
import { getMainLoopModel, getSmallFastModel } from '../../utils/model/model.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import type { BrowserAction, WebBrowserProgress } from './types.js'
import { ActionSchema } from './types.js'
import { getBrowserAgentPrompt } from './prompt.js'

export interface AgenticBrowserOptions {
  task: string
  goal?: string
  maxSteps?: number
  onProgress?: (progress: WebBrowserProgress) => void
}

/**
 * Captures the current page state for the LLM to analyze
 */
async function capturePageState(page: Page): Promise<{
  url: string
  title: string
  screenshot: string
  clickableElements: string[]
}> {
  const url = page.url()
  const title = await page.title()

  // Get screenshot
  const screenshot = await page.screenshot({ encoding: 'base64' })

  // Get clickable elements (a, button, input, select, textarea)
  const clickableElements = await page.evaluate(() => {
    const elements: Array<{ tag: string; text: string; selector: string }> = []
    const tags = ['a', 'button', 'input', 'select', 'textarea']

    for (const tag of tags) {
      const els = document.querySelectorAll(tag)
      els.forEach((el, i) => {
        const text = el.textContent?.trim().slice(0, 100) || ''
        if (text || tag === 'input' || tag === 'textarea') {
          elements.push({
            tag,
            text,
            selector: `${tag}:nth-of-type(${i + 1})`,
          })
        }
      })
    }

    return elements.slice(0, 20) // Limit to 20 elements
  })

  return { url, title, screenshot, clickableElements }
}

/**
 * Run an agentic browser loop where the LLM decides actions
 */
export async function runAgenticBrowser(
  page: Page,
  options: AgenticBrowserOptions,
): Promise<{ success: boolean; result: string }> {
  const { task, goal, maxSteps = 20, onProgress } = options
  let stepsCompleted = 0

  logForDebugging(`Starting agentic browser loop for task: ${task}`)

  while (stepsCompleted < maxSteps) {
    // Capture current page state
    const state = await capturePageState(page)
    logForDebugging(`Step ${stepsCompleted + 1}: Page state captured`)

    onProgress?.({
      type: 'action_start',
      action: 'observe',
      description: `At ${state.url} - ${state.title}`,
    })

    // Ask the LLM what to do next
    const elementsList = state.clickableElements
      .map((e, i) => `${i + 1}. [${e.tag}] "${e.text}" (${e.selector})`)
      .join('\n')

    const userMsg = createUserMessage({
      content: `Current page: ${state.url}
Title: ${state.title}

Available elements:
${elementsList || 'No clickable elements found'}

Task: ${task}
${goal ? `Goal: ${goal}` : ''}

Based on the current page state, what is the next action to take? Respond with a JSON object describing the action.
Example response: {"action": "click", "selector": "button:nth-of-type(1)"}
Example response: {"action": "type", "selector": "input[name=\"q\"]", "text": "search query"}
Example response: {"action": "navigate", "url": "https://example.com"}
Example response: {"action": "screenshot"}
Example response: {"action": "getContent", "type": "text"}

If the task is complete, respond with: {"action": "done", "result": "description of what was accomplished"}`,
    })

    let actionResponse: string | null = null

    try {
      const stream = queryModelWithStreaming({
        messages: [userMsg],
        systemPrompt: asSystemPrompt([getBrowserAgentPrompt(task, goal)]),
        tools: [],
        signal: new AbortController().signal, // This won't be used for cancellation here
        options: {
          model: getSmallFastModel(),
          isNonInteractiveSession: true,
        },
      })

      for await (const event of stream) {
        if (event.type === 'assistant' && event.message.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              actionResponse = block.text
            }
          }
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logForDebugging(`LLM query failed: ${errMsg}`)
      onProgress?.({ type: 'error', message: errMsg })
      break
    }

    if (!actionResponse) {
      onProgress?.({ type: 'error', message: 'No response from LLM' })
      break
    }

    // Parse the LLM response to get the action
    let parsedAction: { action: string; [key: string]: unknown } | null = null
    try {
      // Try to extract JSON from the response
      const jsonMatch = actionResponse.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedAction = JSON.parse(jsonMatch[0])
      }
    } catch {
      // Response wasn't JSON, treat as text feedback
      logForDebugging(`LLM response was not parseable as JSON: ${actionResponse}`)
    }

    if (!parsedAction) {
      // LLM gave textual advice, continue the loop
      stepsCompleted++
      continue
    }

    // Check if done
    if (parsedAction.action === 'done') {
      onProgress?.({
        type: 'goal_achieved',
        result: String(parsedAction.result || 'Task completed'),
      })
      return { success: true, result: String(parsedAction.result || 'Task completed') }
    }

    // Execute the action
    const actionSchema = ActionSchema
    const parseResult = actionSchema.safeParse(parsedAction)

    if (!parseResult.success) {
      logForDebugging(`Invalid action from LLM: ${JSON.stringify(parsedAction)}`)
      stepsCompleted++
      continue
    }

    const action = parseResult.data

    onProgress?.({
      type: 'action_start',
      action: action.action,
      description: `Executing ${action.action}`,
    })

    // Import executeAction dynamically to avoid circular deps
    const { executeAction } = await import('./executeAction.js')
    const result = await executeAction(page, action)

    if (result.screenshot) {
      onProgress?.({ type: 'screenshot', data: result.screenshot })
    }

    if (result.success) {
      onProgress?.({
        type: 'action_complete',
        action: action.action,
        result: result.result || 'Action completed',
      })
    } else {
      onProgress?.({
        type: 'error',
        message: result.error || 'Action failed',
      })
    }

    stepsCompleted++
  }

  onProgress?.({
    type: 'max_steps_reached',
    stepsCompleted,
  })

  return {
    success: false,
    result: `Max steps (${maxSteps}) reached. Completed ${stepsCompleted} steps.`,
  }
}