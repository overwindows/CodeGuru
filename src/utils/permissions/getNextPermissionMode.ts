import { feature } from 'bun:bundle'
import type { ToolPermissionContext } from '../../Tool.js'
import { logForDebugging } from '../debug.js'
import {
  isExternalPermissionMode,
  type ExternalPermissionMode,
  type PermissionMode,
} from './PermissionMode.js'
import {
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from './permissionSetup.js'

// Checks both the cached isAutoModeAvailable (set at startup by
// verifyAutoModeGateAccess) and the live isAutoModeGateEnabled() — these can
// diverge if the circuit breaker or settings change mid-session. The
// live check prevents transitionPermissionMode from throwing
// (permissionSetup.ts:~559), which would silently crash the shift+tab handler
// and leave the user stuck at the current mode.
function canCycleToAuto(ctx: ToolPermissionContext): boolean {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const gateEnabled = isAutoModeGateEnabled()
    const can = !!ctx.isAutoModeAvailable && gateEnabled
    if (!can) {
      logForDebugging(
        `[auto-mode] canCycleToAuto=false: ctx.isAutoModeAvailable=${ctx.isAutoModeAvailable} isAutoModeGateEnabled=${gateEnabled} reason=${getAutoModeUnavailableReason()}`,
      )
    }
    return can
  }
  return false
}

function canCycleToAutopilot(): boolean {
  return !isBypassPermissionsModeDisabled()
}

/**
 * Determines the next permission mode when cycling through modes with Shift+Tab.
 */
export function getNextPermissionMode(
  toolPermissionContext: ToolPermissionContext,
  _teamContext?: { leadAgentId: string },
): PermissionMode {
  switch (toolPermissionContext.mode) {
    case 'default':
      // Ants skip acceptEdits and plan — auto mode replaces them
      if (process.env.USER_TYPE === 'ant') {
        if (toolPermissionContext.isBypassPermissionsModeAvailable) {
          return 'bypassPermissions'
        }
        if (canCycleToAuto(toolPermissionContext)) {
          return 'auto'
        }
        return canCycleToAutopilot() ? 'autopilot' : 'default'
      }
      return 'acceptEdits'

    case 'acceptEdits':
      return 'plan'

    case 'plan':
      if (toolPermissionContext.isBypassPermissionsModeAvailable) {
        return 'bypassPermissions'
      }
      if (canCycleToAuto(toolPermissionContext)) {
        return 'auto'
      }
      return canCycleToAutopilot() ? 'autopilot' : 'default'

    case 'bypassPermissions':
      if (canCycleToAuto(toolPermissionContext)) {
        return 'auto'
      }
      return 'autopilot'

    case 'dontAsk':
      // Not exposed in UI cycle yet, but return default if somehow reached
      return 'default'

    case 'autopilot':
      return 'default'

    case 'auto':
      return canCycleToAutopilot() ? 'autopilot' : 'default'

    default:
      // Unknown future modes always fall back to default.
      return 'default'
  }
}

export function getNextExternalPermissionMode(
  toolPermissionContext: ToolPermissionContext,
): ExternalPermissionMode {
  let candidate = getNextPermissionMode(toolPermissionContext)
  // Guard against future internal-only modes whose cycle never reaches an
  // external mode. 'default' is always external, so it's a safe fallback that
  // guarantees termination. The bound is generous: the current graph reaches
  // an external mode in <=4 steps.
  const maxIterations = 8
  for (let i = 0; i < maxIterations && !isExternalPermissionMode(candidate); i++) {
    candidate = getNextPermissionMode({
      ...toolPermissionContext,
      mode: candidate,
    })
  }
  if (!isExternalPermissionMode(candidate)) {
    logForDebugging(
      `[permissions] getNextExternalPermissionMode failed to reach an external mode after ${maxIterations} steps; falling back to default`,
      { mode: toolPermissionContext.mode },
    )
    return 'default'
  }
  return candidate
}

/**
 * Computes the next permission mode and prepares the context for it.
 * Handles any context cleanup needed for the target mode (e.g., stripping
 * dangerous permissions when entering auto mode).
 *
 * @returns The next mode and the context to use (with dangerous permissions stripped if needed)
 */
export function cyclePermissionMode(
  toolPermissionContext: ToolPermissionContext,
  teamContext?: { leadAgentId: string },
): { nextMode: PermissionMode; context: ToolPermissionContext } {
  const nextMode = getNextPermissionMode(toolPermissionContext, teamContext)
  return {
    nextMode,
    context: transitionPermissionMode(
      toolPermissionContext.mode,
      nextMode,
      toolPermissionContext,
    ),
  }
}
