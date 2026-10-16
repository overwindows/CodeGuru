/**
 * MemoryProvider Plugin System
 *
 * Provides pluggable memory backends:
 * - FileMemoryProvider: file-based (default)
 * - SqliteMemoryProvider: SQLite FTS5 (opt-in)
 *
 * Usage:
 * ```typescript
 * import { registerMemoryProvider, initializeAllProviders } from './memdir/providers/index.js'
 * import { FileMemoryProvider } from './memdir/providers/FileMemoryProvider.js'
 *
 * registerMemoryProvider('file', new FileMemoryProvider(), { enabled: true, priority: 0 })
 * await initializeAllProviders()
 * ```
 */

export {
  type MemoryProvider,
  type MemoryEntry,
  type MemorySearchResult,
  type MemoryProviderConfig,
  type MemoryHeader,
  BaseFileMemoryProvider,
} from './types.js'

export {
  registerMemoryProvider,
  getMemoryProvider,
  getActiveProviders,
  getActiveExternalProvider,
  initializeAllProviders,
  shutdownAllProviders,
  checkAllProvidersHealth,
} from './MemoryProviderRegistry.js'

export { FileMemoryProvider } from './FileMemoryProvider.js'
export { SqliteMemoryProvider } from './SqliteMemoryProvider.js'

// Re-export MemoryManager for convenience
export {
  MemoryManager,
  getMemoryManager,
  initializeMemorySystem,
  shutdownMemorySystem,
} from '../MemoryManager.js'