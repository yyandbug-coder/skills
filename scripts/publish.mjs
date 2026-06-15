#!/usr/bin/env node
/**
 * 发布 skills 仓库到 GitHub（commit + push）。
 *
 * 用法（在仓库根目录）：
 *   node scripts/publish.mjs
 *   node scripts/publish.mjs --dry-run
 *   node scripts/publish.mjs --message "feat: ..."
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const messageIndex = args.indexOf('--message')
const commitMessage =
  messageIndex !== -1 && args[messageIndex + 1]
    ? args[messageIndex + 1]
    : 'chore: publish skills'

function run(command, commandArgs) {
  console.log(`\n[publish] $ ${command} ${commandArgs.join(' ')}`)
  if (dryRun) return { status: 0 }
  return spawnSync(command, commandArgs, { cwd: repoRoot, stdio: 'inherit', shell: false })
}

if (!existsSync(join(repoRoot, '.git'))) {
  console.error('[publish] 当前目录不是 git 仓库')
  process.exit(1)
}

const diff = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf-8' })
if (!diff.stdout.trim()) {
  console.log('[publish] 无变更，跳过')
  process.exit(0)
}

run('git', ['add', '-A'])
const commit = run('git', ['commit', '-m', commitMessage])
if (commit.status !== 0) process.exit(commit.status ?? 1)

const push = run('git', ['push', 'origin', 'HEAD'])
if (push.status !== 0) process.exit(push.status ?? 1)

console.log('\n[publish] 已发布：https://github.com/yyandbug-coder/skills')
console.log('安装示例：npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y')
