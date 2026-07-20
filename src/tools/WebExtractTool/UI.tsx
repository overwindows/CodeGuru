import React from 'react'
import { truncate } from '../../utils/format.js'

export function getToolUseSummary(input: Partial<{
  url: string
  prompt: string
}> | undefined): string | null {
  if (!input?.url) return null
  const { url, prompt } = input
  return prompt ? `${url}: ${prompt}` : url
}

export function renderToolUseMessage(
  input: Partial<{ url: string; prompt: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!input?.url) return null
  let message = `Extracting from "${input.url}"`
  if (verbose && input.prompt) {
    message += ` with prompt: "${truncate(input.prompt, 50)}"`
  }
  return message
}

export function renderToolUseProgressMessage(
  _toolUseID: string,
  _data: unknown,
): React.ReactNode {
  return null
}

export function renderToolResultMessage(
  _input: Partial<{ url: string }>,
  _result: { data: { content: string; title?: string } },
): React.ReactNode {
  return null
}