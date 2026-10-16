/**
 * File-based MemoryProvider
 *
 * Implements MemoryProvider interface using the existing file-based
 * memory system (MEMORY.md index + topic files).
 * Delegates to existing scanMemoryFiles, frontmatter parsing, and LLM selection.
 */

import type {
  MemoryProvider,
  MemoryEntry,
  MemorySearchResult,
  MemoryHeader as ProviderMemoryHeader,
} from './types.js'
import type { MemoryHeader } from '../memoryScan.js'
import {
  formatMemoryManifest,
  scanMemoryFiles,
} from '../memoryScan.js'
import { getAutoMemPath } from '../paths.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { readFileInRange } from '../../utils/readFileInRange.js'
import { getDefaultSonnetModel } from '../../utils/model/model.js'
import { sideQuery } from '../../utils/sideQuery.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import type { MemoryType } from '../memoryTypes.js'

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (Claude Code is already exercising them). DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.`

const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30

export class FileMemoryProvider implements MemoryProvider {
  readonly name = 'file'
  readonly description = 'File-based memory using MEMORY.md and topic files'
  readonly isExternal = false

  private memoryDir: string
  private initialized = false

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? getAutoMemPath()
  }

  async initialize(): Promise<void> {
    this.initialized = true
    logForDebugging(`[FileMemoryProvider] Initialized with dir: ${this.memoryDir}`)
  }

  async shutdown(): Promise<void> {
    this.initialized = false
  }

  async healthCheck(): Promise<boolean> {
    return this.initialized
  }

  async scanMemories(signal?: AbortSignal): Promise<ProviderMemoryHeader[]> {
    this.ensureInitialized()
    const headers = await scanMemoryFiles(
      this.memoryDir,
      signal ?? new AbortController().signal
    )
    return headers.map(this.headerToProviderHeader)
  }

  async searchMemories(
    query: string,
    options?: { limit?: number; signal?: AbortSignal }
  ): Promise<MemorySearchResult[]> {
    this.ensureInitialized()
    const limit = options?.limit ?? 10
    const signal = options?.signal ?? new AbortController().signal

    // Keyword search across all memories
    const headers = await scanMemoryFiles(this.memoryDir, signal)
    const queryLower = query.toLowerCase()

    const results: MemorySearchResult[] = []
    for (const header of headers) {
      const content = await this.getFileContent(header.filePath, signal)
      if (!content) continue

      const { frontmatter } = parseFrontmatter(content, header.filePath)
      const contentLower = content.toLowerCase()
      const descriptionText = (frontmatter.description ?? '').toLowerCase()

      // Check for query match in different fields with different weights
      const nameMatch = header.filename.toLowerCase().includes(queryLower)
      const descMatch = descriptionText.includes(queryLower) || (header.description ?? '').toLowerCase().includes(queryLower)
      const contentMatch = contentLower.includes(queryLower)

      // Calculate relevance score: name match = 3, desc match = 2, content match = 1
      let relevanceScore = 0
      if (nameMatch) relevanceScore = 3
      else if (descMatch) relevanceScore = 2
      else if (contentMatch) relevanceScore = 1

      if (relevanceScore > 0) {
        results.push({
          entry: this.headerToEntry(header, content),
          relevanceScore,
        })
      }

      if (results.length >= limit) break
    }

    return results
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
    const signal = options?.signal ?? new AbortController().signal
    const recentTools = options?.recentTools ?? []

    const headers = await scanMemoryFiles(this.memoryDir, signal)
    if (headers.length === 0) return []

    const selected = await this.selectWithLLM(query, headers, recentTools, signal)
    const selectedHeaders = selected.slice(0, limit)

    // Load full content for selected memories
    const entries: MemoryEntry[] = []
    for (const header of selectedHeaders) {
      const content = await this.getFileContent(header.filePath, signal)
      if (content) {
        entries.push(this.headerToEntry(header, content))
      }
    }

    return entries
  }

  async readMemory(id: string, signal?: AbortSignal): Promise<MemoryEntry | null> {
    this.ensureInitialized()
    const fs = getFsImplementation()
    try {
      const content = await fs.readFile(id, { encoding: 'utf-8', signal })
      const { frontmatter } = parseFrontmatter(content, id)
      const stat = await fs.stat(id)

      return {
        id,
        filePath: id,
        name: frontmatter.name ?? id.split('/').pop()?.replace('.md', '') ?? id,
        description: frontmatter.description ?? null,
        type: frontmatter.type as MemoryType | undefined,
        content,
        mtimeMs: stat.mtimeMs,
      }
    } catch {
      return null
    }
  }

  async saveMemory(
    entry: Omit<MemoryEntry, 'id' | 'mtimeMs'>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    this.ensureInitialized()
    const fs = getFsImplementation()
    const { ensureMemoryDirExists } = await import('../memdir.js')

    await ensureMemoryDirExists(this.memoryDir)

    // Create filename from name
    const filename = entry.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') + '.md'
    const filePath = `${this.memoryDir}/${filename}`

    const now = Date.now()
    const content = this.buildMemoryContent(entry)

    await fs.writeFile(filePath, content, { encoding: 'utf-8', signal })

    // Update MEMORY.md index
    await this.addToEntrypoint(filename, entry.name, entry.description)

    return {
      ...entry,
      id: filePath,
      filePath,
      mtimeMs: now,
    }
  }

  async updateMemory(
    id: string,
    updates: Partial<MemoryEntry>,
    signal?: AbortSignal
  ): Promise<MemoryEntry> {
    this.ensureInitialized()
    const fs = getFsImplementation()

    const current = await this.readMemory(id, signal)
    if (!current) throw new Error(`Memory not found: ${id}`)

    const updated: MemoryEntry = { ...current, ...updates, id, filePath: id }
    const content = this.buildMemoryContent(updated)

    await fs.writeFile(id, content, { encoding: 'utf-8', signal })
    updated.mtimeMs = Date.now()

    return updated
  }

  async deleteMemory(id: string, signal?: AbortSignal): Promise<void> {
    this.ensureInitialized()
    const fs = getFsImplementation()
    try {
      await fs.unlink(id, { signal })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }

  getEntrypointContent(): string {
    const fs = getFsImplementation()
    const entrypoint = `${this.memoryDir}/MEMORY.md`
    try {
      return fs.readFileSync(entrypoint, { encoding: 'utf-8' })
    } catch {
      return ''
    }
  }

  containsPath(path: string): boolean {
    return path.startsWith(this.memoryDir)
  }

  handlesId(_id: string): boolean {
    // File-based providers use file paths, not UUIDs
    return false
  }

  async ensureDir(): Promise<void> {
    const fs = getFsImplementation()
    try {
      await fs.mkdir(this.memoryDir)
    } catch (e) {
      // EEXIST is OK
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'FileMemoryProvider not initialized. Call initialize() first.'
      )
    }
  }

  private headerToProviderHeader(header: MemoryHeader): ProviderMemoryHeader {
    return {
      filePath: header.filePath,
      filename: header.filename,
      description: header.description,
      type: header.type,
      mtimeMs: header.mtimeMs,
    }
  }

  private headerToEntry(header: MemoryHeader, content: string): MemoryEntry {
    return {
      id: header.filePath,
      filePath: header.filePath,
      name: header.filename.replace('.md', ''),
      description: header.description,
      type: header.type,
      content,
      mtimeMs: header.mtimeMs,
    }
  }

  private async getFileContent(
    filePath: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const fs = getFsImplementation()
    try {
      return await fs.readFile(filePath, { encoding: 'utf-8', signal })
    } catch {
      return null
    }
  }

  private async selectWithLLM(
    query: string,
    memories: MemoryHeader[],
    recentTools: readonly string[],
    signal: AbortSignal
  ): Promise<MemoryHeader[]> {
    const validFilenames = new Set(memories.map(m => m.filename))
    const manifest = formatMemoryManifest(memories)

    const toolsSection =
      recentTools.length > 0
        ? `\n\nRecently used tools: ${recentTools.join(', ')}`
        : ''

    try {
      const result = await sideQuery({
        model: getDefaultSonnetModel(),
        system: SELECT_MEMORIES_SYSTEM_PROMPT,
        skipSystemPromptPrefix: true,
        messages: [
          {
            role: 'user',
            content: `Query: ${query}\n\nAvailable memories:\n${manifest}${toolsSection}`,
          },
        ],
        max_tokens: 256,
        output_format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              selected_memories: { type: 'array', items: { type: 'string' } },
            },
            required: ['selected_memories'],
            additionalProperties: false,
          },
        },
        signal,
        querySource: 'memdir_relevance',
      })

      const textBlock = result.content.find(block => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        return []
      }

      const parsed: { selected_memories: string[] } = jsonParse(textBlock.text)
      const selectedNames = parsed.selected_memories.filter(f =>
        validFilenames.has(f)
      )

      return memories.filter(m => selectedNames.includes(m.filename))
    } catch (e) {
      if (signal.aborted) return []
      logForDebugging(
        `[FileMemoryProvider] LLM selection failed: ${errorMessage(e)}`,
        { level: 'warn' }
      )
      return []
    }
  }

  private buildMemoryContent(entry: MemoryEntry): string {
    const frontmatter = [
      '---',
      `name: ${entry.name}`,
      `description: ${entry.description ?? ''}`,
      `type: ${entry.type ?? 'reference'}`,
      entry.scope ? `scope: ${entry.scope}` : '',
      '---',
      '',
    ]
      .filter(Boolean)
      .join('\n')

    return frontmatter + entry.content
  }

  private async addToEntrypoint(
    filename: string,
    name: string,
    description: string | null
  ): Promise<void> {
    const fs = getFsImplementation()
    const entrypoint = `${this.memoryDir}/MEMORY.md`

    const existing = this.getEntrypointContent()
    const newLine = `- [${name}](${filename}) — ${description ?? 'no description'}`

    // Check if already in index
    if (existing.includes(filename)) return

    const updated = existing.trim() + '\n' + newLine + '\n'
    await fs.writeFile(entrypoint, updated, { encoding: 'utf-8' })
  }
}