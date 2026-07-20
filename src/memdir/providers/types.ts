/**
 * MemoryProvider Plugin Architecture
 *
 * Based on Hermes Agent's MemoryProvider pattern.
 * Allows pluggable memory backends (file-based, SQLite FTS5, etc.)
 * with only ONE external provider active at a time.
 */

import type { MemoryType } from '../memoryTypes.js'

/**
 * Represents a single memory entry.
 */
export interface MemoryEntry {
  /** Unique identifier (file path for file-based, UUID for SQLite) */
  id: string
  /** Full file path (empty for SQLite-only entries) */
  filePath: string
  /** Memory name from frontmatter */
  name: string
  /** Description from frontmatter for relevance matching */
  description: string | null
  /** Memory type from frontmatter */
  type: MemoryType | undefined
  /** Full memory content */
  content: string
  /** Last modified timestamp */
  mtimeMs: number
  /** Scope: private (default) or team */
  scope?: 'private' | 'team'
}

/**
 * Search result with relevance scoring.
 */
export interface MemorySearchResult {
  entry: MemoryEntry
  relevanceScore: number
  /** Highlighted snippet from FTS5 search */
  highlightedSnippet?: string
}

/**
 * Configuration for a memory provider.
 */
export interface MemoryProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean
  /** Lower number = higher priority for auto-selection */
  priority: number
  /** Maximum results to return (default: 10) */
  maxResults?: number
}

/**
 * Header info for memory scanning (lightweight, no content).
 * Used for relevance selection without reading full files.
 */
export interface MemoryHeader {
  filePath: string
  filename: string
  description: string | null
  type: MemoryType | undefined
  mtimeMs: number
}

/**
 * Abstract MemoryProvider interface.
 * All memory backends implement this interface.
 */
export interface MemoryProvider {
  /** Unique provider identifier (e.g., 'file', 'sqlite') */
  readonly name: string

  /** Provider description for UI/debugging */
  readonly description: string

  /** Whether this is an "external" provider (SQLite, cloud, etc.)
   *  Only ONE external provider can be active at a time.
   *  File-based providers are NOT external. */
  readonly isExternal: boolean

  /** Initialize the provider (async setup, called at startup) */
  initialize(): Promise<void>

  /** Shutdown the provider (cleanup, called at exit) */
  shutdown(): Promise<void>

  /**
   * Scan for all memory entries.
   * Returns lightweight headers for relevance matching.
   */
  scanMemories(signal?: AbortSignal): Promise<MemoryHeader[]>

  /**
   * Full-text search memories by query string.
   * Uses provider-specific search (keyword for file, FTS5 for SQLite).
   */
  searchMemories(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<MemorySearchResult[]>

  /**
   * Get memories relevant to a specific query.
   * File-based uses LLM selection; SQLite uses FTS5 ranking.
   */
  findRelevantMemories(
    query: string,
    options?: {
      limit?: number
      signal?: AbortSignal
      recentTools?: readonly string[]
    }
  ): Promise<MemoryEntry[]>

  /**
   * Read a specific memory's full content.
   */
  readMemory(id: string, signal?: AbortSignal): Promise<MemoryEntry | null>

  /**
   * Save a new memory.
   * Returns the created entry with assigned id.
   */
  saveMemory(
    entry: Omit<MemoryEntry, 'id' | 'mtimeMs'>,
    signal?: AbortSignal
  ): Promise<MemoryEntry>

  /**
   * Update an existing memory.
   */
  updateMemory(
    id: string,
    updates: Partial<MemoryEntry>,
    signal?: AbortSignal
  ): Promise<MemoryEntry>

  /**
   * Delete a memory.
   */
  deleteMemory(id: string, signal?: AbortSignal): Promise<void>

  /**
   * Get the entrypoint/index content (MEMORY.md for file-based).
   * Used for embedding in prompts.
   */
  getEntrypointContent(): string

  /**
   * Check if a path belongs to this provider's namespace.
   * Used for write safety validation.
   */
  containsPath(path: string): boolean

  /**
   * Check if this provider can handle the given ID.
   * Used for routing read operations (UUID-based providers like SQLite).
   */
  handlesId(id: string): boolean

  /**
   * Ensure the memory directory/namespace exists.
   */
  ensureDir(): Promise<void>

  /**
   * Health check - returns true if provider is operational.
   */
  healthCheck(): Promise<boolean>
}

/**
 * Abstract base class for file-based memory providers.
 * Provides common functionality for file-system backed memories.
 */
export abstract class BaseFileMemoryProvider implements MemoryProvider {
  abstract readonly name: string
  abstract readonly description: string
  readonly isExternal = false

  protected memoryDir: string
  private initialized = false

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir
  }

  async initialize(): Promise<void> {
    this.initialized = true
  }

  async shutdown(): Promise<void> {
    this.initialized = false
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized
  }

  abstract scanMemories(signal?: AbortSignal): Promise<MemoryHeader[]>
  abstract searchMemories(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<MemorySearchResult[]>
  abstract findRelevantMemories(
    query: string,
    options?: {
      limit?: number
      signal?: AbortSignal
      recentTools?: readonly string[]
    }
  ): Promise<MemoryEntry[]>
  abstract readMemory(
    id: string,
    signal?: AbortSignal
  ): Promise<MemoryEntry | null>
  abstract saveMemory(
    entry: Omit<MemoryEntry, 'id' | 'mtimeMs'>,
    signal?: AbortSignal
  ): Promise<MemoryEntry>
  abstract updateMemory(
    id: string,
    updates: Partial<MemoryEntry>,
    signal?: AbortSignal
  ): Promise<MemoryEntry>
  abstract deleteMemory(id: string, signal?: AbortSignal): Promise<void>
  abstract getEntrypointContent(): string

  containsPath(path: string): boolean {
    return path.startsWith(this.memoryDir)
  }

  handlesId(_id: string): boolean {
    // File-based providers use file paths, not IDs
    return false
  }

  abstract ensureDir(): Promise<void>

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `${this.name} MemoryProvider not initialized. Call initialize() first.`
      )
    }
  }
}