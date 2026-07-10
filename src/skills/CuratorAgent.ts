/**
 * CuratorAgent - Background skill maintenance agent
 *
 * Runs after long sessions to:
 * - Archive skills unused for 90+ days
 * - Consolidate similar skills
 * - Record skill improvement suggestions
 */

import { feature } from 'bun:bundle'
import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { getSkillLifecycleManager } from './SkillLifecycleManager.js'
import type { SkillLifecycleState } from './skillStates.js'

/**
 * Default threshold in days for archiving unused skills.
 */
const DEFAULT_UNUSED_THRESHOLD_DAYS = 90

/**
 * State closure for the curator agent.
 */
let curatorState: {
  enabled: boolean
  thresholdDays: number
} = {
  enabled: false,
  thresholdDays: DEFAULT_UNUSED_THRESHOLD_DAYS,
}

/**
 * Initialize the curator agent with feature flag check.
 */
export function initCuratorAgent(): void {
  curatorState.enabled = feature('tengu_curator_agent') ? true : false
  logForDebugging(
    `[CuratorAgent] initialized (enabled=${curatorState.enabled}, threshold=${curatorState.thresholdDays} days)`,
  )
}

/**
 * Check if curator agent is enabled.
 */
export function isCuratorEnabled(): boolean {
  return curatorState.enabled
}

/**
 * Run the curator agent to perform skill maintenance.
 */
export async function runCuratorAgent(
  _canUseTool: unknown,
  _hookContext: unknown,
  options?: {
    unusedDaysThreshold?: number
  },
): Promise<void> {
  if (!curatorState.enabled) {
    logForDebugging('[CuratorAgent] skipped (not enabled)')
    return
  }

  const thresholdDays = options?.unusedDaysThreshold ?? curatorState.thresholdDays
  const lifecycleManager = getSkillLifecycleManager()

  // Get skills for archival
  const skillsForArchival = await lifecycleManager.getSkillsForArchival(
    thresholdDays,
  )

  // Get recently used skills for reference
  const allStates = await lifecycleManager.getAllSkillStates()
  const recentlyUsedSkills = allStates
    .filter(s => s.lastUsedAt && s.state !== 'archived')
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))

  // If nothing to do, skip
  if (skillsForArchival.length === 0) {
    logForDebugging('[CuratorAgent] no skills need archival, skipping')
    return
  }

  logForDebugging(
    `[CuratorAgent] starting - ${skillsForArchival.length} skills for archival`,
  )

  // Perform archival directly (no forked agent, no custom tools needed)
  try {
    let archivedCount = 0
    for (const skill of skillsForArchival) {
      // Skip skills that are still being developed
      if (skill.state === 'developing') {
        logForDebugging(`[CuratorAgent] skipping developing skill: ${skill.skillName}`)
        continue
      }
      await lifecycleManager.archiveSkill(skill.skillName, 'unused')
      archivedCount++
      logForDebugging(`[CuratorAgent] archived skill: ${skill.skillName}`)
    }

    // Identify consolidation opportunities (heuristic: skills with similar names)
    const consolidationSuggestions = findConsolidationOpportunities(recentlyUsedSkills)
    for (const suggestion of consolidationSuggestions) {
      await recordSkillConsolidation(suggestion.skillName, suggestion.reason)
    }

    logForDebugging(
      `[CuratorAgent] completed - ${archivedCount} skills archived, ${consolidationSuggestions.length} consolidation suggestions`,
    )

    logEvent('tengu_curator_agent_run', {
      skills_archived: archivedCount,
      consolidation_suggestions: consolidationSuggestions.length,
    })
  } catch (error) {
    logForDebugging(`[CuratorAgent] error: ${error}`)
  }
}

/**
 * Find potential skill consolidation opportunities.
 * Heuristic: skills with similar prefixes or overlapping functionality.
 */
function findConsolidationOpportunities(
  recentlyUsedSkills: SkillLifecycleState[],
): { skillName: string; reason: string }[] {
  const suggestions: { skillName: string; reason: string }[] = []

  for (let i = 0; i < recentlyUsedSkills.length; i++) {
    for (let j = i + 1; j < recentlyUsedSkills.length; j++) {
      const skillA = recentlyUsedSkills[i]!
      const skillB = recentlyUsedSkills[j]!

      // Check for similar names (shared prefix)
      const minLen = Math.min(skillA.skillName.length, skillB.skillName.length)
      let sharedPrefix = 0
      while (sharedPrefix < minLen && skillA.skillName[sharedPrefix]?.toLowerCase() === skillB.skillName[sharedPrefix]?.toLowerCase()) {
        sharedPrefix++
      }

      // If they share a significant prefix (4+ chars), suggest consolidation
      if (sharedPrefix >= 4) {
        suggestions.push({
          skillName: skillB.skillName,
          reason: `Similar to "${skillA.skillName}" (shared prefix: "${skillA.skillName.slice(0, sharedPrefix)}"). Consider consolidating into a single skill.`,
        })
      }
    }
  }

  return suggestions
}

/**
 * Record a skill archive action (called by the curator agent via tool).
 */
export async function recordSkillArchive(
  skillName: string,
  reason: 'unused' | 'superseded' | 'broken' | 'manual' | 'consolidated',
): Promise<void> {
  const lifecycleManager = getSkillLifecycleManager()
  await lifecycleManager.archiveSkill(skillName, reason)
  logForDebugging(`[CuratorAgent] archived skill "${skillName}" (reason: ${reason})`)

  logEvent('tengu_curator_skill_archived', {
    skill_name: skillName,
    reason,
  })
}

/**
 * Record a skill consolidation suggestion (logged for later review).
 */
export async function recordSkillConsolidation(
  skillName: string,
  reason: string,
): Promise<void> {
  logForDebugging(
    `[CuratorAgent] consolidation suggested for "${skillName}": ${reason}`,
  )

  logEvent('tengu_curator_consolidation_suggested', {
    skill_name: skillName,
    reason,
  })
}