/**
 * 子进程执行。Windows 上 pnpm/npm/yarn 是 .cmd，必须走 shell 才能被 spawn 找到。
 */
import { spawnSync } from 'node:child_process'

import { log, ReleaseError } from './log.mjs'

const NEEDS_SHELL_ON_WINDOWS = new Set(['pnpm', 'npm', 'npx', 'yarn', 'bun'])

/**
 * 拆命令行。只处理引号包裹的整段参数，够表达构建命令了。
 * @param {string} command
 */
export function splitCommand(command) {
  const tokens = String(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const parts = tokens.map((token) => token.replace(/^["']|["']$/g, ''))
  if (parts.length === 0) throw new ReleaseError(`空的命令：${command}`)
  return { bin: parts[0], args: parts.slice(1) }
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, quiet?: boolean }} options
 */
export function run(bin, args, options) {
  if (!options.quiet) log.command(`${bin} ${args.join(' ')}`)
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: process.platform === 'win32' && NEEDS_SHELL_ON_WINDOWS.has(bin),
  })

  if (result.error) {
    throw new ReleaseError(`无法执行 ${bin}：${result.error.message}`, {
      hints: bin === 'pnpm' ? ['Node 装好后执行 corepack enable'] : [],
    })
  }
  return result
}

/**
 * @param {string} command
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, quiet?: boolean }} options
 */
export function runCommand(command, options) {
  const { bin, args } = splitCommand(command)
  const result = run(bin, args, options)
  if (result.status !== 0) {
    throw new ReleaseError(`命令失败（退出码 ${result.status}）：${command}`, {
      exitCode: result.status ?? 1,
    })
  }
  return result
}

/**
 * 静默捕获 stdout，失败返回空串。用于 git 查询这类「失败是正常分支」的调用。
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 */
export function capture(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', shell: false })
  return result.status === 0 ? (result.stdout ?? '').trim() : ''
}
