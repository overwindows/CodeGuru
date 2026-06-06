import { openSync } from 'fs'
import { ReadStream } from 'tty'
import type { RenderOptions } from '../ink.js'
import { isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'

// Cached stdin override - computed once per process
let cachedStdinOverride: ReadStream | undefined | null = null

/**
 * Gets a ReadStream override for stdin when the real stdin is a pipe.
 *
 * On Windows we ALWAYS try \\.\CONIN$ regardless of process.stdin.isTTY,
 * because cli.tsx forces isTTY = true at module-load time on Windows so
 * that flag can no longer be trusted as a "real console handle" indicator.
 * CONIN$ always refers to the controlling console input buffer; if there is
 * no console (CI, service) openSync throws and we return undefined.
 *
 * On non-Windows we open /dev/tty only when process.stdin is not a TTY.
 *
 * Result is cached for the lifetime of the process.
 */
function getStdinOverride(): ReadStream | undefined {
  // Return cached result if already computed
  if (cachedStdinOverride !== null) {
    return cachedStdinOverride
  }

  // Skip in CI environments — no interactive console available
  if (isEnvTruthy(process.env.CI)) {
    cachedStdinOverride = undefined
    return undefined
  }

  // Skip if running as MCP server — input hijacking breaks the protocol
  if (process.argv.includes('mcp')) {
    cachedStdinOverride = undefined
    return undefined
  }

  // ── Windows ────────────────────────────────────────────────────────────────
  // MUST come before the process.stdin.isTTY check.
  // cli.tsx forces process.stdin.isTTY = true on Windows so the app renders,
  // which means isTTY = true on a pipe fd — not a real console handle.
  // Calling setRawMode() on that pipe silently fails at the libuv layer and
  // 'readable' events never fire.  CONIN$ bypasses the pipe and opens the
  // real console input buffer directly.
  //
  // Open with 'r+' (GENERIC_READ | GENERIC_WRITE): libuv's uv_tty_init needs
  // write access to call SetConsoleMode.
  if (process.platform === 'win32') {
    try {
      const ttyFd = openSync('\\\\.\\CONIN$', 'r+')
      const ttyStream = new ReadStream(ttyFd)
      // Mark as TTY so Ink's isRawModeSupported() returns true
      ttyStream.isTTY = true
      cachedStdinOverride = ttyStream
      return cachedStdinOverride
    } catch (err) {
      logError(err as Error)
      cachedStdinOverride = undefined
      return undefined
    }
  }

  // ── Non-Windows ────────────────────────────────────────────────────────────
  // No override needed when stdin is already a real TTY
  if (process.stdin.isTTY) {
    cachedStdinOverride = undefined
    return undefined
  }

  // Try to open /dev/tty as an alternative input source
  try {
    const ttyFd = openSync('/dev/tty', 'r')
    const ttyStream = new ReadStream(ttyFd)
    // Explicitly set isTTY — some runtimes (Bun compiled binaries) may not
    // detect it automatically on an fd-constructed ReadStream.
    ttyStream.isTTY = true
    cachedStdinOverride = ttyStream
    return cachedStdinOverride
  } catch (err) {
    logError(err as Error)
    cachedStdinOverride = undefined
    return undefined
  }
}

/**
 * Returns base render options for Ink, including stdin override when needed.
 * Use this for all render() calls to ensure piped input works correctly.
 *
 * @param exitOnCtrlC - Whether to exit on Ctrl+C (usually false for dialogs)
 */
export function getBaseRenderOptions(
  exitOnCtrlC: boolean = false,
): RenderOptions {
  const stdin = getStdinOverride()
  const options: RenderOptions = { exitOnCtrlC }
  if (stdin) {
    options.stdin = stdin
  }
  return options
}
