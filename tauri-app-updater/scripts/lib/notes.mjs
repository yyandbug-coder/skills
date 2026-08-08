/**
 * 发布说明来源。
 *
 * 老实现让用户在向导里手打一行自由文本，于是线上 manifest 的 notes 长期是
 * `"<App> release v0.1.12"` —— 而这串字符会**原样出现在终端用户的更新提示里**。
 *
 * 正确做法是从项目已有的 changelog 取。项目在 release.config.json 里声明
 * `notesCommand`（如 `node scripts/release-notes.mjs --notes {version}`），
 * Skill 负责调用并把 stdout 当作 notes；同时 `checkCommands` 在发版前跑一遍，
 * changelog 缺条目就直接拦下来。
 */
import { log, ReleaseError } from './log.mjs'
import { capture, runCommand, splitCommand } from './shell.mjs'

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 */
export function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match)
}

/**
 * 跑 notesCommand 取发布说明；没配置或失败则返回空串，由调用方回退。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {string} version
 */
export function resolveNotesFromProject(config, version) {
  if (!config.notesCommand) return ''

  const command = interpolate(config.notesCommand, { version, tag: `v${version}` })
  const { bin, args } = splitCommand(command)
  const output = capture(bin, args, config.projectRoot)
  if (!output) {
    log.warn(`notesCommand 没有输出，将使用默认说明：${command}`)
    return ''
  }
  return output
}

/**
 * 发版前的项目自定义校验（典型用途：changelog 必须有本版本条目）。
 * 任一条失败即中断——版本号已经改了但 changelog 没写，是发版未完成。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {string} version
 */
export function runProjectChecks(config, version) {
  if (config.checkCommands.length === 0) return

  for (const template of config.checkCommands) {
    const command = interpolate(template, { version, tag: `v${version}` })
    try {
      runCommand(command, { cwd: config.projectRoot })
    } catch (error) {
      throw new ReleaseError(`发版前校验未通过：${command}`, {
        hints: [
          error instanceof Error ? error.message : String(error),
          '修好后重跑；或临时用 --skip-checks 跳过（不建议）',
        ],
      })
    }
  }
  log.ok(`发版前校验通过（${config.checkCommands.length} 项）`)
}
