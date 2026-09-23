import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  isAutopilotModeEnabled,
  resetAutopilotModeForTests,
} from '../autopilot.js'
import {
  cyclePermissionMode,
  getNextExternalPermissionMode,
  getNextPermissionMode,
} from './getNextPermissionMode.js'
import {
  isExternalPermissionMode,
  type PermissionMode,
} from './PermissionMode.js'

const originalUserType = process.env.USER_TYPE

afterEach(() => {
  resetAutopilotModeForTests()
  if (originalUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalUserType
  }
})

describe('getNextPermissionMode', () => {
  test('cycles through autopilot before returning to default', () => {
    const base = getEmptyToolPermissionContext()

    expect(
      getNextPermissionMode({
        ...base,
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('bypassPermissions')
    expect(
      getNextPermissionMode({
        ...base,
        mode: 'bypassPermissions',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('autopilot')
    expect(
      getNextPermissionMode({ ...base, mode: 'autopilot' }),
    ).toBe('default')
    expect(
      getNextPermissionMode({
        ...base,
        mode: 'auto',
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('autopilot')
  })

  test('keeps internal autopilot mode out of teammate cycling', () => {
    const base = getEmptyToolPermissionContext()

    expect(
      getNextExternalPermissionMode({
        ...base,
        mode: 'plan',
        isBypassPermissionsModeAvailable: false,
      }),
    ).toBe('default')
  })

  test('keeps autopilot reachable for internal users when bypass is allowed', () => {
    process.env.USER_TYPE = 'ant'
    const base = getEmptyToolPermissionContext()

    expect(
      getNextPermissionMode({
        ...base,
        mode: 'bypassPermissions',
        isAutoModeAvailable: false,
        isBypassPermissionsModeAvailable: true,
      }),
    ).toBe('autopilot')
  })

  test('keeps autopilot reachable in a normal session without bypass mode', () => {
    const base = getEmptyToolPermissionContext()

    expect(
      getNextPermissionMode({
        ...base,
        mode: 'plan',
        isBypassPermissionsModeAvailable: false,
      }),
    ).toBe('autopilot')
  })

  test('Shift+Tab transitions activate and deactivate autopilot guidance', () => {
    const base = getEmptyToolPermissionContext()
    const entering = cyclePermissionMode({
      ...base,
      mode: 'plan',
      isBypassPermissionsModeAvailable: true,
    })

    expect(entering.nextMode).toBe('bypassPermissions')
    const autopilot = cyclePermissionMode({
      ...entering.context,
      mode: entering.nextMode,
      isAutoModeAvailable: false,
    })

    expect(autopilot.nextMode).toBe('autopilot')
    expect(isAutopilotModeEnabled()).toBe(true)

    const leaving = cyclePermissionMode({
      ...autopilot.context,
      mode: autopilot.nextMode,
    })

    expect(leaving.nextMode).toBe('default')
    expect(isAutopilotModeEnabled()).toBe(false)
  })

  test('records the previous mode when cycling into plan mode', () => {
    const entering = cyclePermissionMode({
      ...getEmptyToolPermissionContext(),
      mode: 'acceptEdits',
    })

    expect(entering.nextMode).toBe('plan')
    expect(entering.context.prePlanMode).toBe('acceptEdits')
  })

  test('getNextExternalPermissionMode always returns an external mode (never hangs)', () => {
    const base = getEmptyToolPermissionContext()
    const modes: PermissionMode[] = [
      'default',
      'acceptEdits',
      'plan',
      'bypassPermissions',
      'dontAsk',
      'autopilot',
      'auto',
    ]
    for (const isBypass of [false, true]) {
      for (const mode of modes) {
        const next = getNextExternalPermissionMode({
          ...base,
          mode,
          isBypassPermissionsModeAvailable: isBypass,
        })
        expect(
          isExternalPermissionMode(next),
          `mode=${mode} bypassAvail=${isBypass} -> ${next}`,
        ).toBe(true)
      }
    }
  })
})
