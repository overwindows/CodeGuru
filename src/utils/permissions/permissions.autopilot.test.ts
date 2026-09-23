import { describe, expect, test } from 'bun:test'
import z from 'zod/v4'
import {
  getEmptyToolPermissionContext,
  type AppState,
  type Tool,
  type ToolUseContext,
} from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { hasPermissionsToUseTool } from './permissions.js'
import type { PermissionResult } from './PermissionResult.js'

/**
 * Minimal, in-memory Tool::checkPermissions implementation. At runtime
 * hasPermissionsToUseTool only touches tool.name, tool.inputSchema,
 * tool.checkPermissions and tool.requiresUserInteraction?.(), so we can get
 * away with a hand-rolled stub cast to the full Tool type.
 */
type PermissionResultFn = (input: Record<string, unknown>) => PermissionResult

function makeTool(overrides: {
  name: string
  checkPermissions: PermissionResultFn
  requiresUserInteraction?: () => boolean
}): Tool {
  return {
    name: overrides.name,
    inputSchema: z.object({}),
    requiresUserInteraction: overrides.requiresUserInteraction,
    checkPermissions: input =>
      Promise.resolve(overrides.checkPermissions(input)),
  } as unknown as Tool
}

/** A ToolUseContext that only satisfies the fields the inner function reads. */
function makeContext(toolPermissionContext: Record<string, unknown>) {
  const appState = {
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      ...toolPermissionContext,
    },
  } as unknown as AppState

  return {
    abortController: new AbortController(),
    getAppState: () => appState,
    setAppState: () => {},
  } as unknown as ToolUseContext & { getAppState: () => AppState }
}

/** The remaining arguments to hasPermissionsToUseTool that our cases ignore. */
const dummyAssistantMessage: AssistantMessage = {
  message: { id: 'test-message', role: 'assistant', content: [] },
} as unknown as AssistantMessage

async function decide(
  tool: Tool,
  context: ToolUseContext,
): Promise<{ behavior: string }> {
  return hasPermissionsToUseTool(
    tool,
    {},
    context,
    dummyAssistantMessage,
    'test-tool-use-id',
  )
}

describe('hasPermissionsToUseTool in autopilot mode', () => {
  test('deny rules are still enforced in autopilot mode', async () => {
    const tool = makeTool({
      name: 'MyTool',
      // 1d is not reached — the deny comes from the alwaysDenyRules (step 1a).
      checkPermissions: () => ({ behavior: 'passthrough', message: '' }),
    })
    const context = makeContext({
      mode: 'autopilot',
      alwaysDenyRules: { session: ['MyTool'] },
    })

    const result = await decide(tool, context)

    expect(result.behavior).toBe('deny')
  })

  test('requiresUserInteraction tool still asks in autopilot mode', async () => {
    const tool = makeTool({
      name: 'InteractiveTool',
      requiresUserInteraction: () => true,
      checkPermissions: () => ({
        behavior: 'ask',
        message: 'requires approval',
      }),
    })
    const context = makeContext({ mode: 'autopilot' })

    const result = await decide(tool, context)

    expect(result.behavior).toBe('ask')
  })

  test('safety-check ask is auto-allowed in autopilot mode', async () => {
    const tool = makeTool({
      name: 'SafetyCheckTool',
      checkPermissions: () => ({
        behavior: 'ask',
        message: 'path safety check',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'sensitive file',
          classifierApprovable: false,
        },
      }),
    })

    expect((await decide(tool, makeContext({ mode: 'autopilot' }))).behavior).toBe(
      'allow',
    )
    // In default mode the same safety check still prompts — proving the skip
    // is autopilot-only and not applied globally.
    expect((await decide(tool, makeContext({ mode: 'default' }))).behavior).toBe(
      'ask',
    )
  })

  test('plain bypassPermissions mode still enforces safety checks', async () => {
    const tool = makeTool({
      name: 'SafetyCheckTool',
      checkPermissions: () => ({
        behavior: 'ask',
        message: 'path safety check',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'sensitive file',
          classifierApprovable: false,
        },
      }),
    })
    const context = makeContext({ mode: 'bypassPermissions' })

    const result = await decide(tool, context)

    // bypassPermissions may auto-allow ordinary tools, but safety checks are
    // bypass-immune — they still prompt. Only autopilot skips them.
    expect(result.behavior).toBe('ask')
  })
})
