/**
 * MemoryProvider Registry
 *
 * Manages registration and lifecycle of memory providers.
 * Enforces the single external provider constraint from Hermes.
 */

import type {
  MemoryProvider,
  MemoryProviderConfig,
} from './types.js'
import { logForDebugging } from '../../utils/debug.js'

type RegisteredProvider = {
  provider: MemoryProvider
  config: MemoryProviderConfig
}

const providers = new Map<string, RegisteredProvider>()
let activeExternalProvider: string | null = null

/**
 * Register a memory provider.
 * Throws if attempting to register a second external provider.
 */
export function registerMemoryProvider(
  name: string,
  provider: MemoryProvider,
  config: MemoryProviderConfig
): void {
  if (providers.has(name)) {
    logForDebugging(
      `[MemoryProviderRegistry] Provider "${name}" already registered, skipping`
    )
    return
  }

  // External providers: only one allowed (Hermes constraint)
  if (provider.isExternal) {
    if (activeExternalProvider !== null && activeExternalProvider !== name) {
      const msg =
        `Cannot register external provider "${name}": ` +
        `external provider "${activeExternalProvider}" is already active. ` +
        `Only one external memory provider is allowed.`
      logForDebugging(`[MemoryProviderRegistry] ${msg}`)
      throw new Error(msg)
    }
    activeExternalProvider = name
    logForDebugging(
      `[MemoryProviderRegistry] Registered external provider: ${name}`
    )
  } else {
    logForDebugging(
      `[MemoryProviderRegistry] Registered internal provider: ${name}`
    )
  }

  providers.set(name, { provider, config })
}

/**
 * Get a specific provider by name.
 */
export function getMemoryProvider(name: string): MemoryProvider | undefined {
  return providers.get(name)?.provider
}

/**
 * Get all registered provider names.
 */
export function getRegisteredProviderNames(): string[] {
  return [...providers.keys()]
}

/**
 * Get all enabled providers sorted by priority.
 */
export function getActiveProviders(): MemoryProvider[] {
  return [...providers.values()]
    .filter(p => p.config.enabled)
    .sort((a, b) => a.config.priority - b.config.priority)
    .map(p => p.provider)
}

/**
 * Get the active external provider, if any.
 */
export function getActiveExternalProvider(): MemoryProvider | null {
  if (activeExternalProvider === null) return null
  const registered = providers.get(activeExternalProvider)
  if (!registered?.config.enabled) return null
  return registered.provider
}

/**
 * Get provider config by name.
 */
export function getProviderConfig(
  name: string
): MemoryProviderConfig | undefined {
  return providers.get(name)?.config
}

/**
 * Check if a provider is registered.
 */
export function isProviderRegistered(name: string): boolean {
  return providers.has(name)
}

/**
 * Disable a provider after init failure or runtime degradation.
 */
export function disableMemoryProvider(name: string): void {
  const registered = providers.get(name)
  if (!registered) return

  registered.config.enabled = false
  if (activeExternalProvider === name) {
    activeExternalProvider = null
  }
  logForDebugging(`[MemoryProviderRegistry] Disabled provider: ${name}`)
}

/**
 * Initialize all enabled providers.
 */
export async function initializeAllProviders(): Promise<void> {
  const enabledProviders = [...providers.values()].filter(p => p.config.enabled)
  logForDebugging(
    `[MemoryProviderRegistry] Initializing ${enabledProviders.length} providers`
  )

  await Promise.all(
    enabledProviders.map(async ({ provider, config }) => {
      try {
        await provider.initialize()
        logForDebugging(
          `[MemoryProviderRegistry] Initialized provider: ${provider.name}`
        )
      } catch (error) {
        logForDebugging(
          `[MemoryProviderRegistry] Failed to initialize provider "${provider.name}": ${error}`
        )
        // Disable failed provider
        config.enabled = false
      }
    })
  )
}

/**
 * Shutdown all providers (reverse order for clean teardown).
 */
export async function shutdownAllProviders(): Promise<void> {
  logForDebugging(
    `[MemoryProviderRegistry] Shutting down ${providers.size} providers`
  )

  const reversed = [...providers.values()].reverse()
  await Promise.all(
    reversed.map(async ({ provider }) => {
      try {
        await provider.shutdown()
        logForDebugging(
          `[MemoryProviderRegistry] Shutdown provider: ${provider.name}`
        )
      } catch (error) {
        logForDebugging(
          `[MemoryProviderRegistry] Error shutting down provider "${provider.name}": ${error}`
        )
      }
    })
  )

  providers.clear()
  activeExternalProvider = null
}

/**
 * Check health of all providers.
 * Returns map of provider name to health status.
 */
export async function checkAllProvidersHealth(): Promise<
  Map<string, boolean>
> {
  const results = new Map<string, boolean>()
  for (const [name, { provider }] of providers) {
    try {
      results.set(name, await provider.healthCheck())
    } catch {
      results.set(name, false)
    }
  }
  return results
}

/**
 * Clear all registrations (for testing).
 */
export function _clearRegistryForTesting(): void {
  providers.clear()
  activeExternalProvider = null
}