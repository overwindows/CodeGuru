import React from 'react'
import { truncate } from '../../utils/format.js'

export function getToolUseSummary(input: Partial<{
  query: string
  max_results: number
}> | undefined): string | null {
  if (!input?.query) return null
  const { query } = input
  return `"${query}"`
}

export function renderToolUseMessage(
  input: Partial<{ query: string; max_results: number }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!input?.query) return null
  let message = `Searching X for "${input.query}"`
  if (verbose && input.max_results) {
    message += ` (max ${input.max_results} results)`
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
  _input: Partial<{ query: string }>,
  _result: { data: { tweets: unknown[] } },
): React.ReactNode {
  return null
}