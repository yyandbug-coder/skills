/**
 * 发版相关的 git 操作：提交版本号变更、打 tag、推送到所有远程。
 */
import { log, ReleaseError } from './log.mjs'
import { capture, run } from './shell.mjs'
import { toRelative } from './project.mjs'

/** @param {string} cwd */
export function isGitRepo(cwd) {
  return capture('git', ['rev-parse', '--is-inside-work-tree'], cwd) === 'true'
}

/** @param {string} cwd */
export function currentBranch(cwd) {
  return capture('git', ['branch', '--show-current'], cwd)
}

/** @param {string} cwd */
export function listRemotes(cwd) {
  const output = capture('git', ['remote'], cwd)
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : []
}

/** @param {string} cwd @param {string} tag */
export function tagExists(cwd, tag) {
  return capture('git', ['tag', '--list', tag], cwd) === tag
}

/** 工作区是否有未提交改动（含未跟踪文件）。 @param {string} cwd */
export function isDirty(cwd) {
  return capture('git', ['status', '--porcelain'], cwd).length > 0
}

/**
 * 提交版本号相关文件并打 tag。
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.tag
 * @param {string[]} options.files 绝对路径
 */
export function commitAndTag({ cwd, tag, files }) {
  if (tagExists(cwd, tag)) {
    throw new ReleaseError(`tag ${tag} 已存在`, {
      hints: [`重发同一版本请不要带 --push；确实要重打：git tag -d ${tag}`],
    })
  }

  const relativeFiles = [...new Set(files.map((file) => toRelative(cwd, file)))]
  const added = run('git', ['add', '--', ...relativeFiles], { cwd })
  if (added.status !== 0) throw new ReleaseError('git add 失败')

  const staged = capture('git', ['diff', '--cached', '--name-only'], cwd)
  if (staged) {
    const committed = run('git', ['commit', '-m', `chore: release ${tag}`], { cwd })
    if (committed.status !== 0) throw new ReleaseError('git commit 失败')
  } else {
    log.info('版本号文件无变更，跳过 commit')
  }

  const tagged = run('git', ['tag', tag], { cwd })
  if (tagged.status !== 0) throw new ReleaseError(`git tag ${tag} 失败`)
}

/**
 * 推送当前分支与 tag 到所有远程。任一远程失败即中断——半推成功的状态最难收拾。
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.tag
 */
export function pushAll({ cwd, tag }) {
  const remotes = listRemotes(cwd)
  if (remotes.length === 0) throw new ReleaseError('仓库没有配置任何 git 远程')

  for (const remote of remotes) {
    const branch = run('git', ['push', remote], { cwd })
    if (branch.status !== 0) throw new ReleaseError(`推送分支到 ${remote} 失败`)
    const pushedTag = run('git', ['push', remote, tag], { cwd })
    if (pushedTag.status !== 0) throw new ReleaseError(`推送 tag ${tag} 到 ${remote} 失败`)
  }

  return remotes
}
