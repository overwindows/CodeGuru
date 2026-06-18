import type { Page } from 'playwright'
import { logForDebugging } from '../../utils/debug.js'
import type { BrowserAction } from './types.js'

export interface ActionResult {
  success: boolean
  result?: string
  screenshot?: string // base64 encoded
  error?: string
}

/**
 * Execute a single primitive browser action
 */
export async function executeAction(
  page: Page,
  action: BrowserAction,
): Promise<ActionResult> {
  logForDebugging(`Executing action: ${action.action}`)

  try {
    switch (action.action) {
      case 'navigate':
        await page.goto(action.url, { waitUntil: 'domcontentloaded' })
        return { success: true, result: `Navigated to ${action.url}` }

      case 'click':
        await page.click(action.selector)
        return { success: true, result: `Clicked ${action.selector}` }

      case 'type':
        await page.fill(action.selector, action.text)
        return { success: true, result: `Typed "${action.text}" into ${action.selector}` }

      case 'screenshot':
        const screenshot = await page.screenshot({ encoding: 'base64' })
        return {
          success: true,
          result: `Screenshot captured`,
          screenshot,
        }

      case 'getContent':
        if (action.type === 'html' || !action.type) {
          const html = await page.content()
          return { success: true, result: html }
        } else {
          const text = await page.textContent('body')
          return { success: true, result: text || '' }
        }

      case 'wait':
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout: action.timeout || 30000 })
          return { success: true, result: `Element ${action.selector} appeared` }
        } else if (action.timeout) {
          await page.waitForTimeout(action.timeout)
          return { success: true, result: `Waited ${action.timeout}ms` }
        }
        return { success: true, result: 'Wait complete' }

      case 'evaluate':
        const evalResult = await page.evaluate(action.script)
        return { success: true, result: String(evalResult) }

      case 'scroll':
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded()
        }
        const scrollAmount = action.amount || 500
        const direction = action.direction || 'down'
        const scrollX = direction === 'left' ? -scrollAmount : direction === 'right' ? scrollAmount : 0
        const scrollY = direction === 'up' ? -scrollAmount : direction === 'down' ? scrollAmount : 0
        await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: scrollX, y: scrollY })
        return { success: true, result: `Scrolled ${direction}` }

      case 'select':
        await page.selectOption(action.selector, action.value)
        return { success: true, result: `Selected ${action.value} in ${action.selector}` }

      case 'hover':
        await page.hover(action.selector)
        return { success: true, result: `Hovered over ${action.selector}` }

      case 'press':
        await page.keyboard.press(action.key)
        return { success: true, result: `Pressed ${action.key}` }

      default:
        return { success: false, error: `Unknown action type` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`Action ${action.action} failed: ${message}`)
    return { success: false, error: message }
  }
}

/**
 * Execute multiple actions in sequence
 */
export async function executeActions(
  page: Page,
  actions: BrowserAction[],
  onProgress?: (action: BrowserAction, result: ActionResult) => void,
): Promise<ActionResult[]> {
  const results: ActionResult[] = []

  for (const action of actions) {
    const result = await executeAction(page, action)
    results.push(result)
    onProgress?.(action, result)

    if (!result.success) {
      // Stop on first failure unless it's a minor error
      break
    }
  }

  return results
}