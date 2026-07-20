// Diagnostic: test if stdin receives 'data' events on Windows (flowing mode + explicit resume)
// Run: bun run test_stdin.mjs 2>&1

console.error('[diag] platform:', process.platform);
console.error('[diag] pid:', process.pid);
console.error('[diag] stdin.isTTY:', process.stdin.isTTY);
console.error('[diag] stdin.fd:', process.stdin.fd);
console.error('[diag] CODEGURU_CONIN_RELAUNCH:', process.env.CODEGURU_CONIN_RELAUNCH ?? '(unset)');

if (process.stdin.isTTY) {
  console.error('[diag] stdin IS a TTY — setting raw mode');
  try {
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    console.error('[diag] setRawMode(true) succeeded');
  } catch (e) {
    console.error('[diag] setRawMode(true) THREW:', e.message);
    process.exit(1);
  }

  let data_count = 0;

  // Use 'data' listener (flowing mode) + explicit resume().
  // Mirrors the App.tsx fix for Bun Windows:
  // - 'data' listener alone does NOT start uv_read_start on Bun Windows
  // - resume() is needed to explicitly enter flowing mode
  // - with a 'data' listener present, resume() will NOT be reversed by an
  //   auto-pause (pause() is a no-op when 'data' listeners exist)
  process.stdin.addListener('data', (chunk) => {
    data_count++;
    console.error(`[diag] data event #${data_count}: ${JSON.stringify(chunk)}`);
    if (typeof chunk === 'string' && chunk.includes('\x03')) {
      console.error('[diag] Ctrl+C — exiting (fix WORKS!)');
      try { process.stdin.setRawMode(false); } catch {}
      process.exit(0);
    }
  });
  process.stdin.resume();  // CRITICAL: explicit resume to start uv_read_start on Bun Windows

  console.error('[diag] data listener added + resume() called — press any key (Ctrl+C to exit)...');

  setTimeout(() => {
    console.error(`[diag] 8s timeout — data events received: ${data_count}`);
    if (data_count > 0) {
      console.error('[diag] SUCCESS: data events fired — flowing mode + resume() fix works on this Bun/Windows build');
    } else {
      console.error('[diag] FAILURE: no data events — Bun does not fire data events even with explicit resume()');
      console.error('[diag] Next step: may need to use ReadFile/ReadConsoleInput directly via FFI');
    }
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(data_count > 0 ? 0 : 2);
  }, 8000);
} else {
  console.error('[diag] stdin is NOT a TTY — trying CONIN$ relaunch');

  if (!process.env.CODEGURU_CONIN_RELAUNCH) {
    const { openSync, closeSync } = await import('fs');
    const { spawnSync } = await import('child_process');
    let coninFd = -1;
    try {
      coninFd = openSync('\\\\.\\CONIN$', 'r+');
      console.error('[diag] opened CONIN$ fd:', coninFd);
      const result = spawnSync(process.execPath, [process.argv[1]], {
        stdio: [coninFd, 'inherit', 'inherit'],
        env: { ...process.env, CODEGURU_CONIN_RELAUNCH: '1' },
      });
      closeSync(coninFd);
      console.error('[diag] child exited with:', result.status);
      process.exit(result.status ?? 0);
    } catch(e) {
      if (coninFd >= 0) try { closeSync(coninFd); } catch {}
      console.error('[diag] relaunch failed:', e.message);
      process.exit(1);
    }
  } else {
    console.error('[diag] Already relaunched but stdin still not a TTY — aborting');
    process.exit(3);
  }
}
