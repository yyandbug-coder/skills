/**
 * Resolve Node executable for spawning child scripts (Windows-safe).
 * Prefer process.execPath over "node" so PATHEXT / shim issues are avoided.
 */
export function resolveNodeExecutable() {
  return process.execPath
}
