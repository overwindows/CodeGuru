import { feature } from 'bun:bundle'
import { useStartupNotification } from './useStartupNotification.js'
import {
  clearConsolidationSuggestions,
  getConsolidationSuggestions,
} from '../../skills/CuratorAgent.js'

export function useConsolidationSuggestionsNotification(): void {
  useStartupNotification(async () => {
    if (!feature('tengu_curator_agent')) return null

    const suggestions = await getConsolidationSuggestions()
    if (suggestions.length === 0) return null

    // Clear after surfacing so the same suggestions don't reappear every
    // session. They've been shown once; the curator re-persists any that are
    // still relevant on its next run.
    await clearConsolidationSuggestions()

    return {
      key: 'skill-consolidation',
      text: `Skills: ${suggestions.length} consolidation suggestion${suggestions.length > 1 ? 's' : ''} available`,
      priority: 'normal' as const,
    }
  })
}