/**
 * Register memory providers based on user settings before MemoryManager init.
 */

import { logForDebugging } from '../utils/debug.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { FileMemoryProvider } from './providers/FileMemoryProvider.js'
import {
  isProviderRegistered,
  registerMemoryProvider,
} from './providers/MemoryProviderRegistry.js'
import { SqliteMemoryProvider } from './providers/SqliteMemoryProvider.js'

type MemoryProviderSetting = 'file' | 'sqlite'

function getConfiguredMemoryProvider(): MemoryProviderSetting {
  const configured = getInitialSettings().memoryProvider
  if (configured === 'sqlite') return 'sqlite'
  if (configured === 'file') return 'file'
  if (configured !== undefined) {
    logForDebugging(
      `[MemoryManager] Unknown memoryProvider "${configured}", falling back to file`,
    )
  }
  return 'file'
}

/**
 * Register the active memory provider(s) from settings.
 * Idempotent — safe to call more than once per process.
 */
export function registerMemoryProviders(): void {
  if (isProviderRegistered('file') || isProviderRegistered('sqlite')) {
    return
  }

  const provider = getConfiguredMemoryProvider()

  if (provider === 'sqlite') {
    registerMemoryProvider('sqlite', new SqliteMemoryProvider(), {
      enabled: true,
      priority: 0,
    })
    logForDebugging('[MemoryManager] Registered sqlite memory provider')
    return
  }

  registerMemoryProvider('file', new FileMemoryProvider(), {
    enabled: true,
    priority: 0,
  })
  logForDebugging('[MemoryManager] Registered file memory provider')
}
