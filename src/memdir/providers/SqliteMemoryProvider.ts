/**
 * SQLite FTS5 MemoryProvider
 *
 * Implements MemoryProvider interface using SQLite with FTS5 full-text search.
 * Provides fast cross-session search with BM25 ranking.
 * Opt-in via settings.json: { "memoryProvider": "sqlite" }
 */

import type {
  MemoryProvider,
  MemoryEntry,
  MemorySearchResult,
  MemoryHeader,
} from './types.js'
import type { MemoryType } from '../memoryTypes.js'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getMemoryBaseDir, getAutoMemPath } from '../paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// Database row type
interface MemoryRow {
  id: string
  name: string
  description: string | null
  type: string | null
  scope: string
  content: string
  file_path: string | null
  mtime_ms: number
  created_at: number
  updated_at: number
}

export class SqliteMemoryProvider implements MemoryProvider {
  readonly name = 'sqlite'
  readonly description = 'SQLite FTS5 full-text search memory'
  readonly isExternal = true // Only ONE external provider allowed

  private db: Database | null = null
  private dbPath: string
  private memoryDir: string
  private initialized = false

  constructor(dbPath?: string) {
    const baseDir = getMemoryBaseDir()
    const sqliteDir = join(baseDir, 'sqlite_memory')
    mkdirSync(sqliteDir, { recursive: true })
    this.dbPath = dbPath ?? join(sqliteDir, 'memories.db')
    // SQLite provider uses same directory structure for file_path compatibility
    this.memoryDir = getAutoMemPath()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    let db: InstanceType<(typeof import('bun:sqlite'))['default']> | null = null
    try {
      // Dynamic import for bun:sqlite
      // NOTE: This provider currently only works in Bun runtime.
      // For cross-runtime support (Node.js, Deno), would need to switch to
      // better-sqlite3 or sql.js. See issue: bun:sqlite is Bun-specific.
      const Database = (await import('bun:sqlite')).default
      db = new Database(this.dbPath)

      // Enable WAL mode for better concurrent access
      db.run('PRAGMA journal_mode = WAL')

      // Create tables
      db.run(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT,
          scope TEXT DEFAULT 'private',
          content TEXT NOT NULL,
          file_path TEXT,
          mtime_ms INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          name,
          description,
          content,
          content='memories',
          content_rowid='rowid'
        )
      `)

      // Create indexes
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_mtime ON memories(mtime_ms DESC)
      `)
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)
      `)

      // Create FTS5 sync triggers to keep memories_fts in sync with memories table
      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, name, description, content)
          VALUES (new.rowid, new.name, new.description, new.content);
        END
      `)

      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, name, description, content)
          VALUES ('delete', old.rowid, old.name, old.description, old.content);
        END
      `)

      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, name, description, content)
          VALUES ('delete', old.rowid, old.name, old.description, old.content);
          INSERT INTO memories_fts(rowid, name, description, content)
          VALUES (new.rowid, new.name, new.description, new.content);
        END
      `)

      // Create skill tracking tables
      db.run(`
        CREATE TABLE IF NOT EXISTS skill_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_name TEXT NOT NULL,
          invoked_at INTEGER NOT NULL,
          success INTEGER,
          feedback TEXT
        )
      `)

      db.run(`
        CREATE TABLE IF NOT EXISTS skill_improvements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_name TEXT NOT NULL,
          section TEXT NOT NULL,
          change TEXT NOT NULL,
          reason TEXT,
          applied_at INTEGER NOT NULL,
          reverted_at INTEGER
        )
      `)

      db.run(`
        CREATE TABLE IF NOT EXISTS skill_states (
          skill_name TEXT PRIMARY KEY,
          state TEXT NOT NULL DEFAULT 'active',
          archived_at INTEGER,
          archive_reason TEXT,
          usage_count INTEGER DEFAULT 0,
          last_used_at INTEGER
        )
      `)

      // Index for skill_usage.skill_name
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_skill_usage_skill_name ON skill_usage(skill_name)
      `)

      // Index for skill_states.last_used_at
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_skill_states_last_used ON skill_states(last_used_at)
      `)

      this.db = db
      this.initialized = true
      logForDebugging(`[SqliteMemoryProvider] Initialized at ${this.dbPath}`)
    } catch (error) {
      // Clean up partial state on failure
      db?.close()
      this.db = null
      this.initialized = false
      logForDebugging(`[SqliteMemoryProvider] Initialization failed: ${error}`)
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.db?.close()
    this.db = null
    this.initialized = false
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) return false
      this.db.run('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async scanMemories(signal?: AbortSignal): Promise<MemoryHeader[]> {
    this.ensureInitialized()
    const rows = this.db!.query(
      'SELECT id, name, description, type, file_path, mtime_ms FROM memories ORDER BY mtime_ms DESC'
    ).all() as Pick<MemoryRow, 'id' | 'name' | 'description' | 'type' | 'file_path' | 'mtime_ms'>[]

    return rows.map(row => ({
      filePath: row.file_path ?? row.id,
      filename: row.name + '.md',
      description: row.description,
      type: row.type as MemoryType | undefined,
      mtimeMs: row.mtime_ms,
    }))
  }

  async searchMemories(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<MemorySearchResult[]> {
    this.ensureInitialized()
    const limit = options?.limit ?? 10

    // Use FTS5 for full-text search with BM25 ranking
    const rows = this.db!.query(`
      SELECT m.*, bm25(memories_fts) as rank,
             snippet(memories_fts, 2, '<mark>', '</mark>', '...', 32) as snippet
      FROM memories m
      JOIN memories_fts f ON m.rowid = f.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as (MemoryRow & { rank: number; snippet: string })[]

    return rows.map(row => ({
      entry: this.rowToEntry(row),
      relevanceScore: Math.abs(row.rank),
      highlightedSnippet: row.snippet,
    }))
  }

  async findRelevantMemories(
    query: string,
    options?: {
      limit?: number
      signal?: AbortSignal
      recentTools?: readonly string[]
    }
  ): Promise<MemoryEntry[]> {
    this.ensureInitialized()
    const limit = options?.limit ?? 5

    // Use FTS5 search results directly
    // Could enhance with LLM re-ranking for better relevance
    const results = await this.searchMemories(query, { limit, signal: options?.signal })
    return results.map(r => r.entry)
  }

  async readMemory(id: string, signal?: AbortSignal): Promise<MemoryEntry | null> {
    this.ensureInitialized()
    const row = this.db!.query(
      'SELECT * FROM memories WHERE id = ? OR file_path = ?'
    ).get(id, id) as MemoryRow | undefined

    return row ? this.rowToEntry(row) : null
  }

  async saveMemory(
    entry: Omit<MemoryEntry, 'id' | 'mtimeMs'>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    this.ensureInitialized()
    const id = randomUUID()
    const now = Date.now()

    this.db!.run(`
      INSERT INTO memories (id, name, description, type, scope, content, file_path, mtime_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      entry.name,
      entry.description,
      entry.type,
      entry.scope ?? 'private',
      entry.content,
      entry.filePath,
      now,
      now,
      now
    )

    return { ...entry, id, filePath: entry.filePath || id, mtimeMs: now }
  }

  async updateMemory(
    id: string,
    updates: Partial<MemoryEntry>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    this.ensureInitialized()
    const now = Date.now()
    const current = await this.readMemory(id, signal)
    if (!current) throw new Error(`Memory not found: ${id}`)

    const updated: MemoryEntry = {
      ...current,
      ...updates,
      id,
      mtimeMs: now,
    }

    this.db!.run(`
      UPDATE memories SET
        name = ?,
        description = ?,
        type = ?,
        scope = ?,
        content = ?,
        mtime_ms = ?,
        updated_at = ?
      WHERE id = ?
    `,
      updated.name,
      updated.description,
      updated.type,
      updated.scope ?? 'private',
      updated.content,
      now,
      now,
      id
    )

    return updated
  }

  async deleteMemory(id: string, signal?: AbortSignal): Promise<void> {
    this.ensureInitialized()
    this.db!.run('DELETE FROM memories WHERE id = ? OR file_path = ?', id, id)
  }

  getEntrypointContent(): string {
    // SQLite doesn't have a MEMORY.md equivalent
    // Return empty string - index is managed differently
    return ''
  }

  containsPath(path: string): boolean {
    // SQLite stores memories by UUID, not by file path
    // But for compatibility, check if it's in our memory directory
    return path.startsWith(this.memoryDir)
  }

  handlesId(id: string): boolean {
    // SQLite uses UUIDs as IDs - check if it looks like a UUID
    // UUID format: 8-4-4-4-12 hex characters
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return uuidRegex.test(id)
  }

  async ensureDir(): Promise<void> {
    // Directory is created in constructor
  }

  // --- Skill lifecycle tracking methods ---

  async recordSkillUsage(skillName: string, success: boolean, feedback?: string): Promise<void> {
    this.ensureInitialized()
    this.db!.run(`
      INSERT INTO skill_usage (skill_name, invoked_at, success, feedback)
      VALUES (?, ?, ?, ?)
    `, skillName, Date.now(), success ? 1 : 0, feedback)

    // Update skill usage count
    this.db!.run(`
      INSERT INTO skill_states (skill_name, usage_count, last_used_at)
      VALUES (?, 1, ?)
      ON CONFLICT(skill_name) DO UPDATE SET
        usage_count = usage_count + 1,
        last_used_at = ?
    `, skillName, Date.now(), Date.now())
  }

  async archiveSkill(skillName: string, reason: string): Promise<void> {
    this.ensureInitialized()
    this.db!.run(`
      UPDATE skill_states SET state = 'archived', archived_at = ?, archive_reason = ?
      WHERE skill_name = ?
    `, Date.now(), reason, skillName)
  }

  async getSkillState(skillName: string): Promise<{ state: string; usageCount: number; lastUsedAt: number | null } | null> {
    this.ensureInitialized()
    const row = this.db!.query(`
      SELECT state, usage_count, last_used_at FROM skill_states WHERE skill_name = ?
    `).get(skillName) as { state: string; usage_count: number; last_used_at: number | null } | undefined

    return row
      ? { state: row.state, usageCount: row.usage_count, lastUsedAt: row.last_used_at }
      : null
  }

  async recordSkillImprovement(
    skillName: string,
    section: string,
    change: string,
    reason: string
  ): Promise<void> {
    this.ensureInitialized()
    this.db!.run(`
      INSERT INTO skill_improvements (skill_name, section, change, reason, applied_at)
      VALUES (?, ?, ?, ?, ?)
    `, skillName, section, change, reason, Date.now())
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SqliteMemoryProvider not initialized. Call initialize() first.')
    }
  }

  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      filePath: row.file_path ?? row.id,
      name: row.name,
      description: row.description ?? null,
      type: row.type as MemoryType | undefined,
      content: row.content,
      mtimeMs: row.mtime_ms,
      scope: row.scope as 'private' | 'team' | undefined,
    }
  }
}