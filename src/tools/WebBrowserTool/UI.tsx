import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { Output, WebBrowserProgress } from './types.js'

export function renderToolUseMessage({
  task,
  actions,
}: Partial<{
  task?: string
  actions?: Array<{ action: string }>
}>, {
  verbose
}: {
  verbose: boolean
}): React.ReactNode {
  if (task) {
    return `🌐 ${task}`
  }
  if (actions && actions.length > 0) {
    return `🌐 Browser: ${actions.map(a => a.action).join(' → ')}`
  }
  return '🌐 Browser control'
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage<WebBrowserProgress>[],
): React.ReactNode {
  if (progressMessages.length === 0) {
    return null
  }

  const lastProgress = progressMessages[progressMessages.length - 1]
  if (!lastProgress?.data) {
    return null
  }

  const data = lastProgress.data

  switch (data.type) {
    case 'action_start':
      return (
        <MessageResponse>
          <Text dimColor>{data.description}</Text>
        </MessageResponse>
      )
    case 'action_complete':
      return (
        <MessageResponse>
          <Text dimColor>✓ {data.result}</Text>
        </MessageResponse>
      )
    case 'error':
      return (
        <MessageResponse>
          <Text color="red">Error: {data.message}</Text>
        </MessageResponse>
      )
    case 'goal_achieved':
      return (
        <MessageResponse>
          <Text color="green">✓ Goal: {data.result}</Text>
        </MessageResponse>
      )
    case 'max_steps_reached':
      return (
        <MessageResponse>
          <Text color="yellow">Max steps reached ({data.stepsCompleted})</Text>
        </MessageResponse>
      )
    default:
      return null
  }
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const statusIcon = output.success ? '✓' : '✗'
  const statusColor = output.success ? 'green' : 'red'

  return (
    <Box flexDirection="column" gap={1}>
      <MessageResponse height={1}>
        <Text>
          <Text color={statusColor as 'green' | 'red'}>{statusIcon}</Text>
          {' '}{output.message}
        </Text>
      </MessageResponse>
      {output.screenshot && (
        <MessageResponse height={1}>
          <Text dimColor>[Screenshot captured - base64 length: {output.screenshot.length}]</Text>
        </MessageResponse>
      )}
    </Box>
  )
}

export function getToolUseSummary(input: Partial<{
  task?: string
  actions?: Array<{ action: string }>
}> | undefined): string | null {
  if (input?.task) {
    return input.task.slice(0, 80)
  }
  if (input?.actions && input.actions.length > 0) {
    return `Browser: ${input.actions.map(a => a.action).join(' → ')}`
  }
  return null
}