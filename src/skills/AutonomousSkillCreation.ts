/**
 * Autonomous Skill Creation
 *
 * Detects skill-worthy patterns from successful session behavior
 * and presents the user with "Create skill?" prompts.
 *
 * Flow:
 * 1. extractMemories/dream agent detects a pattern that could be a skill
 * 2. The pattern is logged as a skill creation suggestion
 * 3. After session ends, user is prompted to create a skill
 */

import { feature } from 'bun:bundle'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * Skill creation suggestion from autonomous detection.
 */
export interface SkillCreationSuggestion {
  id: string
  pattern: string
  description: string
  exampleUsage?: string
  detectedAt: number
  sessionId: string
  confidence: 'low' | 'medium' | 'high'
}

/**
 * State for skill creation suggestions.
 */
let suggestions: SkillCreationSuggestion[] = []
let enabled = false

/**
 * Initialize autonomous skill creation.
 */
export function initAutonomousSkillCreation(): void {
  enabled = feature('tengu_autonomous_skills') ? true : false
  logForDebugging(`[AutonomousSkillCreation] initialized (enabled=${enabled})`)
}

/**
 * Check if autonomous skill creation is enabled.
 */
export function isAutonomousSkillCreationEnabled(): boolean {
  return enabled
}

/**
 * Record a skill creation suggestion.
 * Called by extraction/dream agents when they detect skill-worthy patterns.
 */
export function recordSkillCreationSuggestion(
  pattern: string,
  description: string,
  options?: {
    exampleUsage?: string
    confidence?: 'low' | 'medium' | 'high'
  },
): void {
  if (!enabled) return

  const suggestion: SkillCreationSuggestion = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pattern,
    description,
    exampleUsage: options?.exampleUsage,
    detectedAt: Date.now(),
    sessionId: '', // Will be filled by caller if needed
    confidence: options?.confidence ?? 'medium',
  }

  suggestions.push(suggestion)
  logForDebugging(
    `[AutonomousSkillCreation] recorded suggestion: ${pattern} (confidence: ${suggestion.confidence})`,
  )

  logEvent('tengu_skill_suggestion_detected', {
    pattern,
    confidence: suggestion.confidence,
    total_suggestions: suggestions.length,
  })
}

/**
 * Get all pending skill creation suggestions.
 */
export function getSkillCreationSuggestions(): SkillCreationSuggestion[] {
  return [...suggestions]
}

/**
 * Clear a skill creation suggestion (after user acts on it).
 */
export function clearSkillCreationSuggestion(id: string): void {
  suggestions = suggestions.filter(s => s.id !== id)
}

/**
 * Clear all suggestions (after session ends or user dismisses all).
 */
export function clearAllSkillSuggestions(): void {
  suggestions = []
}

/**
 * Build a skill creation prompt for the user.
 * Called at session end to present skill creation options.
 */
export function buildSkillCreationPrompt(): string | null {
  if (suggestions.length === 0) return null

  const suggestionsText = suggestions
    .map(
      (s, i) =>
        `${i + 1}. **${s.pattern}**\n   ${s.description}${
          s.exampleUsage ? `\n   Example: ${s.exampleUsage}` : ''
        }\n   Confidence: ${s.confidence}`,
    )
    .join('\n\n')

  return `## Skill Creation Suggestions

Based on your session, I detected ${suggestions.length} pattern${
    suggestions.length > 1 ? 's' : ''
  } that could become skills:

${suggestionsText}

Would you like me to create any of these as skills?`
}