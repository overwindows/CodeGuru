import { afterEach, describe, expect, test } from 'bun:test'
import {
  activateAutopilotMode,
  AUTOPILOT_ENV_VAR,
  deactivateAutopilotMode,
  getAutopilotSystemPromptSection,
  isAutopilotModeEnabled,
  resetAutopilotModeForTests,
} from './autopilot.js'

const originalValue = process.env[AUTOPILOT_ENV_VAR]

afterEach(() => {
  resetAutopilotModeForTests()
  if (originalValue === undefined) {
    delete process.env[AUTOPILOT_ENV_VAR]
  } else {
    process.env[AUTOPILOT_ENV_VAR] = originalValue
  }
})

describe('autopilot mode', () => {
  test('is disabled by default', () => {
    delete process.env[AUTOPILOT_ENV_VAR]

    expect(isAutopilotModeEnabled()).toBe(false)
    expect(getAutopilotSystemPromptSection()).toBeNull()
  })

  test('adds autonomous execution guidance when activated', () => {
    activateAutopilotMode()

    expect(isAutopilotModeEnabled()).toBe(true)
    expect(getAutopilotSystemPromptSection()).toContain(
      'fully completed and verified',
    )
    expect(getAutopilotSystemPromptSection()).toContain(
      'Permission prompts are automatically approved',
    )
  })

  test('can be disabled even when enabled by the environment', () => {
    process.env[AUTOPILOT_ENV_VAR] = '1'
    deactivateAutopilotMode()

    expect(isAutopilotModeEnabled()).toBe(false)
  })
})
