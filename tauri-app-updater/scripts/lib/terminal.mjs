/**
 * Clear terminal when interactive; no-op in CI / piped stdout (Windows-safe).
 */
export function safeClearConsole() {
  if (!process.stdout.isTTY) return
  try {
    console.clear()
  } catch {
    // ignore terminals that do not support clear
  }
}
