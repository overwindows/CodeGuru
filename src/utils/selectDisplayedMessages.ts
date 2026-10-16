type DisplayedMessageSelection = {
  isLoading: boolean
  showStreamingText: boolean
  completedHistoryLength: number
}

export function selectDisplayedMessages<T>(
  messages: T[],
  deferredMessages: T[],
  {
    isLoading,
    showStreamingText,
    completedHistoryLength,
  }: DisplayedMessageSelection,
): T[] {
  if (!isLoading || showStreamingText) return messages

  // Never replace the last completed transcript with an older deferred
  // snapshot. A shorter current array means the transcript was reset.
  if (
    messages.length < completedHistoryLength ||
    deferredMessages.length < completedHistoryLength
  ) {
    return messages
  }

  return deferredMessages
}
