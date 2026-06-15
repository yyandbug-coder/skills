#!/usr/bin/env node
/**
 * 将当前分支与 tag 推送到所有已配置的 Git 远程（origin + gitcode）。
 */
import { spawnSync } from 'node:child_process'

import { getProjectRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const args = process.argv.slice(2)

function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) return ''
  return args[index + 1]
}

function hasRemote(name) {
  const result = spawnSync('git', ['remote', 'get-url', name], {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
  })
  return result.status === 0
}

function run(commandArgs) {
  console.log(`[git-push-all] $ git ${commandArgs.join(' ')}`)
  const result = spawnSync('git', commandArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

/** @type {string[]} */
const remotes = []
if (hasRemote('origin')) remotes.push('origin')
if (hasRemote('gitcode')) remotes.push('gitcode')

if (remotes.length === 0) {
  console.error('[git-push-all] 未找到 origin 或 gitcode 远程')
  process.exit(1)
}

const tagName = readArg('--tag')

for (const remote of remotes) {
  run(['push', remote])
  if (tagName) {
    run(['push', remote, tagName])
  }
}

console.log(`[git-push-all] 已推送到：${remotes.join(', ')}${tagName ? `（含 tag ${tagName}）` : ''}`)
