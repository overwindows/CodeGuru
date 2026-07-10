/**
 * SkillLifecycleManager - Manages skill lifecycle states
 *
 * Based on Hermes Agent's Curator agent patterns.
 * Handles skill archival, restoration, usage tracking, and metadata management.
 * Metadata stored in ~/.codeguru/skills/.metadata/
 */

import type {
  SkillState,
  SkillArchiveReason,
  SkillLifecycleState,
  SkillMetadata,
} from './skillStates.js'
import { createDefaultLifecycleState, isSkillStale } from './skillStates.js'
import { join } from 'path'
import { readFile, writeFile, readdir, unlink } from 'fs/promises'
import { getCodeGuruConfigHomeDir } from '../utils/envUtils.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'
import { isENOENT } from '../utils/errors.js'

const SKILLS_METADATA_SUBDIR = 'skills/.metadata'

export class SkillLifecycleManager {
  private metadataCache = new Map<string, SkillLifecycleState>()
  /** In-flight load promises for deduplication */
  private pendingLoads = new Map<string, Promise<SkillLifecycleState>>()

  /**
   * Get the metadata directory path.
   * Uses the CodeGuru config home directory, not cwd, so metadata
   * is stored consistently regardless of where CodeGuru is run from.
   */
  private getMetadataDir(): string {
    return join(getCodeGuruConfigHomeDir(), SKILLS_METADATA_SUBDIR)
  }

  /**
   * Get metadata file path for a skill.
   */
  private getMetadataPath(skillName: string): string {
    return join(this.getMetadataDir(), `${this.sanitizeFilename(skillName)}.json`)
  }

  /**
   * Sanitize skill name for use as filename.
   */
  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  /**
   * Ensure metadata directory exists.
   */
  async ensureMetadataDir(): Promise<void> {
    const fs = getFsImplementation()
    const dir = this.getMetadataDir()
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (e) {
      if (!isENOENT(e)) throw e
    }
  }

  /**
   * Update skill lifecycle state.
   */
  async updateSkillState(
    skillName: string,
    updates: Partial<SkillLifecycleState>
  ): Promise<SkillLifecycleState> {
    const current = await this.getSkillState(skillName)
    const updated: SkillLifecycleState = { ...current, ...updates }
    this.metadataCache.set(skillName, updated)

    await this.ensureMetadataDir()
    const metadataPath = this.getMetadataPath(skillName)
    await writeFile(metadataPath, JSON.stringify(updated, null, 2), 'utf-8')
    this.log(`Updated state for "${skillName}": ${JSON.stringify(updates)}`)
    return updated
  }

  /**
   * Get skill state with deduplication for concurrent requests.
   * If the same skill is being loaded concurrently, returns the same promise.
   */
  async getSkillState(skillName: string): Promise<SkillLifecycleState> {
    // Check cache first
    const cached = this.metadataCache.get(skillName)
    if (cached) return cached

    // Check if there's already a pending load for this skill
    const pending = this.pendingLoads.get(skillName)
    if (pending) return pending

    // Create a new load promise with deduplication
    const loadPromise = (async () => {
      const metadataPath = this.getMetadataPath(skillName)
      try {
        const content = await readFile(metadataPath, 'utf-8')
        const state = JSON.parse(content) as SkillLifecycleState
        this.metadataCache.set(skillName, state)
        return state
      } catch {
        // Return default state
        return createDefaultLifecycleState(skillName)
      } finally {
        // Clean up pending promise
        this.pendingLoads.delete(skillName)
      }
    })()

    this.pendingLoads.set(skillName, loadPromise)
    return loadPromise
  }

  /**
   * Increment usage count for a skill.
   */
  async recordUsage(skillName: string): Promise<void> {
    const state = await this.getSkillState(skillName)
    await this.updateSkillState(skillName, {
      usageCount: state.usageCount + 1,
      lastUsedAt: Date.now(),
    })
  }

  /**
   * Archive a skill.
   */
  async archiveSkill(
    skillName: string,
    reason: SkillArchiveReason
  ): Promise<void> {
    await this.updateSkillState(skillName, {
      state: 'archived',
      archivedAt: Date.now(),
      archiveReason: reason,
    })
    this.log(`Archived skill "${skillName}" (reason: ${reason})`)
  }

  /**
   * Restore an archived skill.
   */
  async restoreSkill(skillName: string): Promise<void> {
    await this.updateSkillState(skillName, {
      state: 'active',
      archivedAt: undefined,
      archiveReason: undefined,
    })
    this.log(`Restored skill "${skillName}"`)
  }

  /**
   * Promote a developing skill to active.
   */
  async promoteSkill(skillName: string): Promise<void> {
    await this.updateSkillState(skillName, {
      state: 'active',
    })
    this.log(`Promoted skill "${skillName}" to active`)
  }

  /**
   * Demote an active skill to developing.
   */
  async demoteToDeveloping(skillName: string): Promise<void> {
    await this.updateSkillState(skillName, {
      state: 'developing',
    })
    this.log(`Demoted skill "${skillName}" to developing`)
  }

  /**
   * Get all skills with their lifecycle states.
   */
  async getAllSkillStates(): Promise<SkillLifecycleState[]> {
    const metadataDir = this.getMetadataDir()
    try {
      const fs = getFsImplementation()
      const entries = await fs.readdir(metadataDir)
      const states: SkillLifecycleState[] = []

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        try {
          const content = await readFile(
            join(metadataDir, entry.name),
            'utf-8'
          )
          states.push(JSON.parse(content))
        } catch {
          // Skip invalid files
        }
      }

      return states
    } catch {
      return []
    }
  }

  /**
   * Get skills that should be considered for archival.
   */
  async getSkillsForArchival(
    unusedDaysThreshold = 90
  ): Promise<SkillLifecycleState[]> {
    const allStates = await this.getAllSkillStates()
    return allStates.filter(s => isSkillStale(s, unusedDaysThreshold))
  }

  /**
   * Get skills by state.
   */
  async getSkillsByState(state: SkillState): Promise<SkillLifecycleState[]> {
    const allStates = await this.getAllSkillStates()
    return allStates.filter(s => s.state === state)
  }

  /**
   * Get active skills (not archived).
   */
  async getActiveSkills(): Promise<SkillLifecycleState[]> {
    const allStates = await this.getAllSkillStates()
    return allStates.filter(s => s.state !== 'archived')
  }

  /**
   * Delete skill metadata (for skill deletion).
   */
  async deleteSkillMetadata(skillName: string): Promise<void> {
    const metadataPath = this.getMetadataPath(skillName)
    this.metadataCache.delete(skillName)
    try {
      await unlink(metadataPath)
    } catch (e) {
      if (!isENOENT(e)) throw e
    }
  }

  /**
   * Increment improvement count for a skill.
   */
  async recordImprovement(skillName: string): Promise<void> {
    const state = await this.getSkillState(skillName)
    await this.updateSkillState(skillName, {
      improvementsApplied: state.improvementsApplied + 1,
    })
  }

  /**
   * Check if a skill is archived.
   */
  async isArchived(skillName: string): Promise<boolean> {
    const state = await this.getSkillState(skillName)
    return state.state === 'archived'
  }

  /**
   * Clear internal cache (for testing).
   */
  clearCache(): void {
    this.metadataCache.clear()
  }

  private log(msg: string): void {
    logForDebugging(`[SkillLifecycleManager] ${msg}`)
  }
}

// Singleton instance
let lifecycleManagerInstance: SkillLifecycleManager | null = null

/**
 * Get the singleton SkillLifecycleManager instance.
 */
export function getSkillLifecycleManager(): SkillLifecycleManager {
  if (!lifecycleManagerInstance) {
    lifecycleManagerInstance = new SkillLifecycleManager()
  }
  return lifecycleManagerInstance
}