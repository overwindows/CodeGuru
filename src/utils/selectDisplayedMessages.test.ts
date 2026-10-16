import { describe, expect, test } from 'bun:test'
import { selectDisplayedMessages } from './selectDisplayedMessages.js'

describe('selectDisplayedMessages', () => {
  const previousTurn = ['user-1', 'assistant-1']
  const currentTurn = [...previousTurn, 'user-2']

  test('does not regress completed history while deferred messages catch up', () => {
    expect(
      selectDisplayedMessages(currentTurn, ['user-1'], {
        isLoading: true,
        showStreamingText: false,
        completedHistoryLength: previousTurn.length,
      }),
    ).toBe(currentTurn)
  })

  test('uses deferred messages once they contain the completed history', () => {
    const deferred = [...previousTurn]

    expect(
      selectDisplayedMessages(currentTurn, deferred, {
        isLoading: true,
        showStreamingText: false,
        completedHistoryLength: previousTurn.length,
      }),
    ).toBe(deferred)
  })

  test('uses current messages while streaming and after loading', () => {
    const deferred = [...previousTurn]

    expect(
      selectDisplayedMessages(currentTurn, deferred, {
        isLoading: true,
        showStreamingText: true,
        completedHistoryLength: previousTurn.length,
      }),
    ).toBe(currentTurn)
    expect(
      selectDisplayedMessages(currentTurn, deferred, {
        isLoading: false,
        showStreamingText: false,
        completedHistoryLength: previousTurn.length,
      }),
    ).toBe(currentTurn)
  })

  test('does not resurrect deferred history after a transcript reset', () => {
    const resetMessages: string[] = []

    expect(
      selectDisplayedMessages(resetMessages, previousTurn, {
        isLoading: true,
        showStreamingText: false,
        completedHistoryLength: previousTurn.length,
      }),
    ).toBe(resetMessages)
  })
})
