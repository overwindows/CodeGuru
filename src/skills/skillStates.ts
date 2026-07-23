/**
 * Skill Lifecycle State Types
 *
 * Based on Hermes Agent's skill self-improvement and Curator agent patterns.
 * Tracks skill states: active, archived, developing
 */

/**
 * Skill lifecycle states.
 */
export type SkillState = 'active' | 'archived' | 'developing'

/**
 * Reasons a skill may be archived.
 */
export type SkillArchiveReason =
  | 'unused' // Not used for extended period (90+ days)
  | 'superseded' // Replaced by better skill
  | 'broken' // Consistently fails
  | 'manual' // User explicitly archived
  | 'consolidated' // Merged into another skill

/**
 * Full skill lifecycle state stored in metadata.
 */
export interface SkillLifecycleState {
  skillName: string
  state: SkillState
  archivedAt?: number
  archiveReason?: SkillArchiveReason
  usageCount: number
  lastUsedAt?: number
  createdAt: number
  improvementsApplied: number
  version: string
  /** Source of creation: user, system, plugin */
  createdBy: 'user' | 'system' | 'plugin'
}

/**
 * Skill metadata stored in .codeguru/skills/.metadata/
 */
export interface SkillMetadata {
  state: SkillState
  archivedAt?: number
  archiveReason?: string
  usageCount: number
  lastUsedAt?: number
  version: string
  createdBy: 'user' | 'system' | 'plugin'
  improvementsApplied: number
}

/**
 * Skill improvement record.
 */
export interface SkillImprovement {
  id: number
  skillName: string
  section: string
  change: string
  reason?: string
  appliedAt: number
  revertedAt?: number
}

/**
 * Skill usage record.
 */
export interface SkillUsageRecord {
  id: number
  skillName: string
  invokedAt: number
  success: boolean
  feedback?: string
}

/**
 * Default lifecycle state for new skills.
 */
export function createDefaultLifecycleState(
  skillName: string,
  createdBy: 'user' | 'system' | 'plugin' = 'user'
): SkillLifecycleState {
  return {
    skillName,
    state: 'active',
    usageCount: 0,
    createdAt: Date.now(),
    improvementsApplied: 0,
    version: '1.0.0',
    createdBy,
  }
}

/**
 * Check if a skill should be considered stale (unused for threshold).
 */
export function isSkillStale(
  state: SkillLifecycleState,
  unusedDaysThreshold = 90
): boolean {
  if (state.state !== 'active') return false
  if (!state.lastUsedAt) return false

  const unusedMs = Date.now() - state.lastUsedAt
  const unusedDays = unusedMs / (24 * 60 * 60 * 1000)
  return unusedDays >= unusedDaysThreshold
}