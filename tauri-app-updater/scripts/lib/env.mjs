/**
 * 从项目根的 `.env` 读 token 等变量（不覆盖已存在的 process.env）。
 *
 * 发版 token 写进 shell profile 很容易漏配（尤其 Windows PowerShell 换个会话就没了），
 * 放项目 `.env` 更稳；`.env` 必须在 .gitignore 里。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @param {string} value */
function unquote(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** @param {string} projectRoot */
export function loadDotenv(projectRoot) {
  const envPath = join(projectRoot, '.env')
  if (!existsSync(envPath)) return []

  /** @type {string[]} */
  const loaded = []
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq <= 0) continue

    const key = line.slice(0, eq).trim()
    if (key && process.env[key] === undefined) {
      process.env[key] = unquote(line.slice(eq + 1))
      loaded.push(key)
    }
  }
  return loaded
}
