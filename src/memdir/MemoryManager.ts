/**
 * MemoryManager - Orchestrates memory providers for the agent
 *
 * Based on Hermes Agent's MemoryManager pattern.
 * Single integration point that delegates to registered providers.
 * Only ONE external provider allowed - enforces provider isolation.
 */

import type {
  MemoryProvider,
  MemoryEntry,
  MemorySearchResult,
  MemoryHeader,
} from './providers/types.js'
import {
  disableMemoryProvider,
  getActiveProviders,
  getActiveExternalProvider,
} from './providers/MemoryProviderRegistry.js'
import { registerMemoryProviders } from './registerMemoryProviders.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * MemoryManager orchestrates all memory providers.
 * Provides a unified interface for memory operations across providers.
 */
export class MemoryManager {
  private _providers: MemoryProvider[] = []

  /**
   * Initialize with all registered providers.
   */
  async initialize(): Promise<void> {
    const candidates = getActiveProviders()

    const initResults = await Promise.all(
      candidates.map(async provider => {
        try {
          await provider.initialize()
          return { provider, ok: true as const }
        } catch (error) {
          logForDebugging(
            `[MemoryManager] Failed to initialize provider ${provider.name}: ${error}`,
          )
          disableMemoryProvider(provider.name)
          return { provider, ok: false as const }
        }
      }),
    )

    this._providers = initResults.filter(r => r.ok).map(r => r.provider)
    logForDebugging(
      `[MemoryManager] Initialized with ${this._providers.length} providers`,
    )
  }

  /**
   * Shutdown all providers.
   */
  async shutdown(): Promise<void> {
    const reversed = [...this._providers].reverse()
    await Promise.all(
      reversed.map(async provider => {
        try {
          await provider.shutdown()
        } catch (error) {
          logForDebugging(
            `[MemoryManager] Error shutting down ${provider.name}: ${error}`
          )
        }
      })
    )
    this._providers = []
  }

  /**
   * Get all active providers.
   */
  get providers(): MemoryProvider[] {
    return [...this._providers]
  }

  /**
   * Get the active external provider, if any.
   */
  getActiveExternalProvider(): MemoryProvider | null {
    return getActiveExternalProvider()
  }

  /**
   * Scan all memories across all providers.
   * External provider takes precedence if available.
   */
  async scanAllMemories(signal?: AbortSignal): Promise<MemoryHeader[]> {
    const external = getActiveExternalProvider()
    if (external) {
      return external.scanMemories(signal)
    }

    // Use first available internal provider
    const provider = this._providers[0]
    if (!provider) return []
    return provider.scanMemories(signal)
  }

  /**
   * Search memories across all providers.
   * External provider takes precedence.
   */
  async searchAllMemories(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<MemorySearchResult[]> {
    const external = getActiveExternalProvider()
    if (external) {
      return external.searchMemories(query, options)
    }

    const provider = this._providers[0]
    if (!provider) return []
    return provider.searchMemories(query, options)
  }

  /**
   * Find relevant memories using LLM selection (file-based) or FTS5 (SQLite).
   * External provider takes precedence.
   */
  async findRelevantMemories(
    query: string,
    options?: {
      limit?: number
      signal?: AbortSignal
      recentTools?: readonly string[]
    }
  ): Promise<MemoryEntry[]> {
    const external = getActiveExternalProvider()
    if (external) {
      return external.findRelevantMemories(query, options)
    }

    const provider = this._providers[0]
    if (!provider) return []
    return provider.findRelevantMemories(query, options)
  }

  /**
   * Read a specific memory by ID (file path or UUID).
   */
  async readMemory(id: string, signal?: AbortSignal): Promise<MemoryEntry | null> {
    // Try each provider until we find the memory
    for (const provider of this._providers) {
      if (provider.containsPath(id) || provider.handlesId(id)) {
        const memory = await provider.readMemory(id, signal)
        if (memory) return memory
      }
    }
    return null
  }

  /**
   * Save a new memory.
   * Uses the first available provider (external if present, else internal).
   */
  async saveMemory(
    entry: Omit<MemoryEntry, 'id' | 'mtimeMs'>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    const external = getActiveExternalProvider()
    const provider = external ?? this._providers[0]

    if (!provider) {
      throw new Error('No memory provider available')
    }

    return provider.saveMemory(entry, signal)
  }

  /**
   * Update an existing memory.
   */
  async updateMemory(
    id: string,
    updates: Partial<MemoryEntry>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    for (const provider of this._providers) {
      if (provider.containsPath(id)) {
        return provider.updateMemory(id, updates, signal)
      }
    }
    throw new Error(`Memory provider not found for: ${id}`)
  }

  /**
   * Delete a memory.
   */
  async deleteMemory(id: string, signal?: AbortSignal): Promise<void> {
    for (const provider of this._providers) {
      if (provider.containsPath(id)) {
        return provider.deleteMemory(id, signal)
      }
    }
    throw new Error(`Memory provider not found for: ${id}`)
  }

  /**
   * Get entrypoint content (MEMORY.md for file-based).
   */
  getEntrypointContent(): string {
    const external = getActiveExternalProvider()
    if (external) {
      return external.getEntrypointContent()
    }

    const provider = this._providers[0]
    if (!provider) return ''
    return provider.getEntrypointContent()
  }

  /**
   * Check if a path belongs to any provider's namespace.
   */
  containsPath(path: string): boolean {
    return this._providers.some(p => p.containsPath(path))
  }

  /**
   * Ensure memory directory exists.
   */
  async ensureDir(): Promise<void> {
    const provider = this._providers[0]
    if (provider) {
      await provider.ensureDir()
    }
  }

  /**
   * Health check - true if any provider is healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (this._providers.length === 0) return false
    return Promise.any(
      this._providers.map(async p => {
        const healthy = await p.healthCheck()
        return healthy ? p.name : Promise.reject()
      })
    ).then(() => true, () => false)
  }
}

// Singleton instance
let memoryManagerInstance: MemoryManager | null = null

/**
 * Get the singleton MemoryManager instance.
 */
export function getMemoryManager(): MemoryManager {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MemoryManager()
  }
  return memoryManagerInstance
}

/**
 * Initialize the memory system.
 * Call at application startup.
 */
export async function initializeMemorySystem(): Promise<void> {
  registerMemoryProviders()
  const manager = getMemoryManager()
  await manager.initialize()
}

/**
 * Shutdown the memory system.
 * Call at application exit.
 */
export async function shutdownMemorySystem(): Promise<void> {
  if (memoryManagerInstance) {
    await memoryManagerInstance.shutdown()
    memoryManagerInstance = null
  }
}