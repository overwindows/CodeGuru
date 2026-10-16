import { isEnvTruthy } from './envUtils.js'

export const AUTOPILOT_ENV_VAR = 'CODEGURU_AUTOPILOT_MODE'

let activeOverride: boolean | undefined

export function activateAutopilotMode(): void {
  activeOverride = true
}

export function deactivateAutopilotMode(): void {
  activeOverride = false
}

export function resetAutopilotModeForTests(): void {
  activeOverride = undefined
}

export function isAutopilotModeEnabled(): boolean {
  return activeOverride ?? isEnvTruthy(process.env[AUTOPILOT_ENV_VAR])
}

export function getAutopilotSystemPromptSection(): string | null {
  if (!isAutopilotModeEnabled()) return null

  return `# Autopilot Mode

Work autonomously until the user's request is fully completed and verified.
- Make reasonable, reversible decisions when details are missing instead of stopping for optional clarification.
- Use available tools to implement the solution; do not stop after only explaining or planning it.
- Continue through investigation, implementation, and validation. If an approach fails, diagnose it and try a sound alternative.
- Before finishing, verify the requested outcome with the narrowest relevant tests, build, lint, or direct runtime check.
- Permission prompts are automatically approved in this mode. Treat that capability carefully: honor explicit denials, avoid exposing secrets, and do not perform destructive or out-of-scope actions merely because no confirmation is required.
- Ask the user only when progress is genuinely blocked by required information, authorization, or an irreversible high-impact choice.`
}
