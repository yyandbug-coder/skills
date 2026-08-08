/**
 * `cli.mjs wizard`（默认命令）—— 交互式发版向导，本质是给 release 拼参数。
 *
 * 向导里**不再让用户手打 release notes**：说明来自项目 changelog（notesCommand），
 * 用户只做「发哪几个平台、版本怎么走、传不传」这几个真正需要决策的选择。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { releaseCommand } from './release.mjs'
import { bumpVersion, readProjectVersion, resolveArtifactDir } from '../lib/project.mjs'
import { log, ReleaseError, setLogScope } from '../lib/log.mjs'
import { PLATFORMS } from '../lib/platforms.mjs'
import { listTargets, missingTokenHint } from '../lib/targets.mjs'
import { resolveNotesFromProject } from '../lib/notes.mjs'
import { parseArgs } from '../lib/args.mjs'

/**
 * @param {string} projectRoot
 */
async function loadPrompts(projectRoot) {
  try {
    const require = createRequire(join(projectRoot, 'package.json'))
    return await import(pathToFileURL(require.resolve('@clack/prompts')).href)
  } catch {
    throw new ReleaseError('向导需要项目安装 @clack/prompts', {
      hints: ['pnpm add -D @clack/prompts', '或改用非交互模式：cli.mjs release --part patch --upload'],
    })
  }
}

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 */
export async function wizardCommand({ config }) {
  setLogScope('release')
  const p = await loadPrompts(config.projectRoot)
  const currentVersion = readProjectVersion(config)

  /** @param {unknown} value */
  const guard = (value) => {
    if (p.isCancel(value)) {
      p.cancel('已取消发版')
      process.exit(0)
    }
    return value
  }

  p.intro(`${config.appName} 发版向导`)

  const action = guard(
    await p.select({
      message: '这次要做什么',
      options: [
        { value: 'full', label: '构建并发布', hint: '构建 → 校验 → 上传 → 线上自检' },
        { value: 'build', label: '只构建', hint: '产物留在本地，稍后再传' },
        { value: 'upload', label: '只上传已有产物', hint: '跳过构建' },
        { value: 'doctor', label: '只体检', hint: '查签名密钥、token、endpoint 可达性' },
        { value: 'dry-run', label: '预览流程', hint: '什么都不做，只打印计划' },
      ],
    }),
  )

  if (action === 'doctor') {
    const { doctorCommand } = await import('./doctor.mjs')
    return doctorCommand({ config, args: parseArgs([]) })
  }

  // 「只上传」走 upload 命令：它读 releases/v{version}/ 里已有的产物与 manifest，
  // 不像 release --skip-build 那样还要去 bundle 目录重新收集（构建机与发布机常常不是同一台）。
  if (action === 'upload') {
    return uploadOnly({ config, p, guard, currentVersion })
  }

  /** @type {string[]} */
  const argv = []

  // ── 版本 ───────────────────────────────────────────────
  const strategy = guard(
    await p.select({
      message: '版本号',
      options: [
        { value: 'patch', label: `patch → v${bumpVersion(currentVersion, 'patch')}` },
        { value: 'minor', label: `minor → v${bumpVersion(currentVersion, 'minor')}` },
        { value: 'major', label: `major → v${bumpVersion(currentVersion, 'major')}` },
        { value: 'keep', label: `保持 v${currentVersion}`, hint: '重发同一版本' },
        { value: 'set', label: '手动指定' },
      ],
      initialValue: 'patch',
    }),
  )

  let targetVersion = currentVersion
  if (strategy === 'set') {
    targetVersion = String(
      guard(
        await p.text({
          message: '版本号',
          initialValue: currentVersion,
          validate: (value) =>
            /^v?\d+\.\d+\.\d+/.test(String(value).trim()) ? undefined : '形如 0.1.13',
        }),
      ),
    ).trim().replace(/^v/, '')
    argv.push('--set-version', targetVersion)
  } else if (strategy !== 'keep') {
    argv.push('--part', strategy)
    targetVersion = bumpVersion(currentVersion, /** @type {'patch'|'minor'|'major'} */ (strategy))
  }

  // ── 平台 ───────────────────────────────────────────────
  const platforms = guard(
    await p.multiselect({
      message: '构建哪些平台（空格多选）',
      options: Object.values(PLATFORMS).map((platform) => ({
        value: platform.id,
        label: platform.label,
        hint: platform.rustTarget ?? '不指定 target',
      })),
      initialValues: ['host'],
      required: true,
    }),
  )
  argv.push('--platform', /** @type {string[]} */ (platforms).join(','))

  // ── 发布说明 ───────────────────────────────────────────
  const notes = resolveNotesFromProject(config, targetVersion)
  if (notes) {
    p.note(notes.length > 600 ? `${notes.slice(0, 600)}…` : notes, '发布说明（来自项目 changelog）')
  } else {
    p.log.warn(
      config.notesCommand
        ? 'changelog 里没取到本版本的说明，将使用默认文案'
        : '未配置 notesCommand，将使用默认文案；建议接上项目 changelog',
    )
  }

  // ── 上传 ───────────────────────────────────────────────
  let upload = action === 'full'
  if (upload) {
    const targets = listTargets(config)
    const missing = targets.filter((target) => !target.token)
    if (missing.length > 0) {
      p.log.warn(missing.map((target) => `${target.label}：${missingTokenHint(target)}`).join('\n'))
    }
    if (missing.length === targets.length) {
      upload = Boolean(
        guard(await p.confirm({ message: '所有平台都缺 token，仍要继续吗？', initialValue: false })),
      )
    }
  }

  if (upload) {
    argv.push('--upload')

    const artifactDir = resolveArtifactDir(config, targetVersion)
    if (existsSync(artifactDir)) {
      const replace = guard(
        await p.confirm({
          message: '远端已有同名附件时，删除并重传？',
          initialValue: false,
        }),
      )
      if (replace) argv.push('--replace')
    }

    const push = guard(
      await p.confirm({ message: '同时提交版本号、打 tag 并 push 到所有远程？', initialValue: false }),
    )
    if (push) argv.push('--push')
  }

  if (action === 'dry-run') argv.push('--dry-run')

  const summary = [
    `版本：v${currentVersion}${targetVersion !== currentVersion ? ` → v${targetVersion}` : '（保持）'}`,
    `参数：release ${argv.join(' ')}`,
  ].join('\n')
  p.note(summary, '即将执行')

  const confirmed = guard(await p.confirm({ message: '开始？', initialValue: true }))
  if (!confirmed) {
    p.cancel('已取消发版')
    process.exit(0)
  }

  p.outro('开始执行')
  await releaseCommand({ config, args: parseArgs(argv) })
  log.ok('向导结束')
}

/**
 * 「只上传已有产物」分支。
 *
 * @param {object} params
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} params.config
 * @param {Record<string, Function>} params.p
 * @param {(value: unknown) => unknown} params.guard
 * @param {string} params.currentVersion
 */
async function uploadOnly({ config, p, guard, currentVersion }) {
  const version = String(
    guard(
      await p.text({
        message: '上传哪个版本的产物',
        initialValue: currentVersion,
        validate: (value) =>
          existsSync(resolveArtifactDir(config, String(value).trim().replace(/^v/, '')))
            ? undefined
            : `找不到 ${config.releaseDir}/v${String(value).trim().replace(/^v/, '')}/`,
      }),
    ),
  ).trim().replace(/^v/, '')

  const replace = guard(
    await p.confirm({ message: '远端已有同名附件时，删除并重传？', initialValue: false }),
  )

  const argv = ['--version', version]
  if (replace) argv.push('--replace')

  p.outro('开始上传')
  const { uploadCommand } = await import('./upload.mjs')
  await uploadCommand({ config, args: parseArgs(argv) })

  const { verifyCommand } = await import('./verify.mjs')
  await verifyCommand({ config, args: parseArgs(['--version', version]) })
}
