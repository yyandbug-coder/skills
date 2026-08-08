/**
 * 统一日志前缀与退出语义。
 *
 * 发版脚本最怕「报了一半就 process.exit」——调用方拿不到上下文，也无法在向导里
 * 收尾。这里统一约定：库层只抛 `ReleaseError`，退出码由唯一入口 cli.mjs 决定。
 */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR

/** @param {string} code @param {string} text */
function paint(code, text) {
  return COLOR ? `\u001B[${code}m${text}\u001B[0m` : text
}

export const dim = (text) => paint('2', text)
export const bold = (text) => paint('1', text)
export const green = (text) => paint('32', text)
export const yellow = (text) => paint('33', text)
export const red = (text) => paint('31', text)
export const cyan = (text) => paint('36', text)

/** 预期内的失败（配置缺失、校验不过、远端拒绝）；不打印堆栈。 */
export class ReleaseError extends Error {
  /**
   * @param {string} message
   * @param {{ hints?: string[], exitCode?: number }} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'ReleaseError'
    this.hints = options.hints ?? []
    this.exitCode = options.exitCode ?? 1
  }
}

let scope = 'release'

/** @param {string} next */
export function setLogScope(next) {
  scope = next
}

const prefix = () => dim(`[${scope}]`)

export const log = {
  /** @param {string} message */
  info(message) {
    console.log(`${prefix()} ${message}`)
  },
  /** @param {string} message */
  step(message) {
    console.log(`\n${prefix()} ${bold(message)}`)
  },
  /** @param {string} message */
  ok(message) {
    console.log(`${prefix()} ${green('✓')} ${message}`)
  },
  /** @param {string} message */
  warn(message) {
    console.warn(`${prefix()} ${yellow('!')} ${message}`)
  },
  /** @param {string} message */
  fail(message) {
    console.error(`${prefix()} ${red('✗')} ${message}`)
  },
  /** @param {string} message */
  detail(message) {
    console.log(`  ${dim(message)}`)
  },
  /** @param {string} command */
  command(command) {
    console.log(`${prefix()} ${cyan('$')} ${command}`)
  },
}
