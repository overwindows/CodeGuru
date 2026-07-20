import { z } from 'zod/v4'

// Primitive browser actions
export const ActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('navigate'),
    url: z.string().describe('URL to navigate to'),
  }),
  z.object({
    action: z.literal('click'),
    selector: z.string().describe('CSS selector or XPath of element to click'),
  }),
  z.object({
    action: z.literal('type'),
    selector: z.string().describe('CSS selector of input element'),
    text: z.string().describe('Text to type'),
  }),
  z.object({
    action: z.literal('screenshot'),
    filename: z.string().optional().describe('Optional filename for screenshot'),
  }),
  z.object({
    action: z.literal('getContent'),
    type: z.enum(['text', 'html']).optional().describe('Content type to retrieve'),
  }),
  z.object({
    action: z.literal('wait'),
    selector: z.string().optional().describe('Wait for this selector to appear'),
    timeout: z.number().optional().describe('Timeout in milliseconds'),
  }),
  z.object({
    action: z.literal('evaluate'),
    script: z.string().describe('JavaScript to execute'),
  }),
  z.object({
    action: z.literal('scroll'),
    selector: z.string().optional().describe('Element to scroll into view'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction'),
    amount: z.number().optional().describe('Scroll amount in pixels'),
  }),
  z.object({
    action: z.literal('select'),
    selector: z.string().describe('CSS selector of select element'),
    value: z.string().describe('Value to select'),
  }),
  z.object({
    action: z.literal('hover'),
    selector: z.string().describe('CSS selector of element to hover over'),
  }),
  z.object({
    action: z.literal('press'),
    key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab")'),
  }),
])

export type BrowserAction = z.infer<typeof ActionSchema>

// Session state for persistent browser sessions
export interface SessionState {
  sessionId: string
  createdAt: number
  lastAccessedAt: number
  url: string
  title: string
}

// Progress events for streaming
export type WebBrowserProgress = {
  type: 'action_start'
  action: string
  description: string
} | {
  type: 'action_complete'
  action: string
  result: string
} | {
  type: 'screenshot'
  data: string // base64 encoded
} | {
  type: 'error'
  message: string
} | {
  type: 'goal_achieved'
  result: string
} | {
  type: 'max_steps_reached'
  stepsCompleted: number
}

export const BrowserModeSchema = z.enum(['headless', 'headed'])
export type BrowserMode = z.infer<typeof BrowserModeSchema>