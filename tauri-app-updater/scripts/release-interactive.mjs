#!/usr/bin/env node
/**
 * Tauri 应用自动更新 Skill — 交互式发版向导。
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { importFromProject } from './lib/import-from-project.mjs'
import { getAppDisplayName, loadReleaseConfigRaw } from './lib/load-release-config.mjs'
import { hasReleaseArtifacts } from './lib/release-artifacts.mjs'
import {
  describeBuildPlan,
  hasDesktopBuild,
  normalizePlatformSelection,
  platformSelectionLabel,
} from './lib/release-platforms.mjs'
import { getProjectVersion } from './lib/project-version.mjs'
import { getProjectRoot, getSkillRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const p = await importFromProject(projectRoot, '@clack/prompts')
const releaseConfigRaw = loadReleaseConfigRaw(projectRoot)
const appName = getAppDisplayName(projectRoot, releaseConfigRaw)
const currentVersion = await getProjectVersion(projectRoot)
const artifactDir = join(projectRoot, 'releases/artifacts')
const releaseScript = join(getSkillRoot(), 'scripts', 'release.mjs')

function hasArtifacts() {
  return hasReleaseArtifacts(artifactDir)
}

function runRelease(args) {
  p.log.step(`执行：node ${releaseScript} ${args.join(' ')}`)
  const result = spawnSync('node', [releaseScript, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function cancelIfNeeded(value) {
  if (p.isCancel(value)) {
    p.cancel('已取消发版。')
    process.exit(0)
  }
  return value
}

async function main() {
  console.clear()
  p.intro(`${appName} 发版向导`)

  const action = cancelIfNeeded(
    await p.select({
      message: '选择发版操作',
      options: [
        { value: 'build', label: '仅打包', hint: '本地构建 + 生成 latest.json，不上传' },
        { value: 'build-upload', label: '打包并上传', hint: '构建后上传到 GitHub + GitCode Release' },
        { value: 'upload-only', label: '仅上传已有产物', hint: '跳过构建，上传 releases/artifacts/' },
        { value: 'dry-run', label: '预览流程', hint: 'dry-run，不实际构建/上传' },
      ],
    }),
  )

  /** @type {string[]} */
  const releaseArgs = []
  if (action === 'dry-run') releaseArgs.push('--dry-run')

  if (action === 'upload-only') {
    releaseArgs.push('--skip-build')
    if (!hasArtifacts()) {
      p.log.warn('releases/artifacts/ 为空或不存在，请先执行「仅打包」。')
      const continueAnyway = cancelIfNeeded(
        await p.confirm({ message: '仍要继续上传吗？', initialValue: false }),
      )
      if (!continueAnyway) {
        p.cancel('已取消发版。')
        process.exit(0)
      }
    }
  }

  let targetVersion = currentVersion
  let versionLabel = `保持当前版本 v${currentVersion}`

  const versionStrategy = cancelIfNeeded(
    await p.select({
      message: '版本号策略',
      options: [
        {
          value: 'keep',
          label: `保持当前版本 v${currentVersion}`,
          hint: action === 'upload-only' ? '上传到当前版本 tag' : '适合重打同一版本',
        },
        { value: 'set', label: '指定版本号', hint: '手动输入，例如 0.1.3' },
        { value: 'patch', label: `自动递增 patch → v${bumpPreview(currentVersion, 'patch')}` },
        { value: 'minor', label: `自动递增 minor → v${bumpPreview(currentVersion, 'minor')}` },
        { value: 'major', label: `自动递增 major → v${bumpPreview(currentVersion, 'major')}` },
      ],
    }),
  )

  if (versionStrategy === 'keep') {
    releaseArgs.push('--skip-bump')
    versionLabel = `保持当前版本 v${currentVersion}`
    targetVersion = currentVersion
  } else if (versionStrategy === 'set') {
    const inputVersion = cancelIfNeeded(
      await p.text({
        message: '输入目标版本号',
        placeholder: '0.1.3',
        initialValue: currentVersion,
        validate(value) {
          const normalized = String(value).trim().replace(/^v/, '')
          if (!/^\d+\.\d+\.\d+/.test(normalized)) return '请输入有效语义化版本，例如 0.1.3'
        },
      }),
    )
    targetVersion = String(inputVersion).trim().replace(/^v/, '')
    releaseArgs.push('--set-version', targetVersion)
    versionLabel = `指定版本 v${targetVersion}`
  } else {
    releaseArgs.push('--part', versionStrategy)
    targetVersion = bumpPreview(currentVersion, versionStrategy)
    versionLabel = `递增 ${versionStrategy} → v${targetVersion}`
  }

  const selectedPlatforms = cancelIfNeeded(
    await p.multiselect({
      message: '选择发版平台（空格切换，可多选）',
      options: [
        { value: 'desktop', label: '桌面（当前主机）', hint: '默认 pnpm tauri build' },
        { value: 'windows', label: 'Windows', hint: 'x86_64-pc-windows-msvc' },
        { value: 'macos', label: 'macOS', hint: 'aarch64-apple-darwin' },
        { value: 'linux', label: 'Linux', hint: 'x86_64-unknown-linux-gnu' },
        { value: 'android', label: 'Android', hint: 'APK + AAB' },
        { value: 'ios', label: 'iOS', hint: 'IPA' },
      ],
      initialValues: ['desktop'],
      required: true,
    }),
  )

  let platformSelection
  try {
    platformSelection = normalizePlatformSelection(selectedPlatforms)
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  releaseArgs.push('--platform', selectedPlatforms.join(','))

  const defaultNotes = action === 'upload-only' ? `${appName} ${targetVersion}` : `${appName} release`
  const notes = cancelIfNeeded(
    await p.text({
      message: '更新说明（Release notes）',
      placeholder: defaultNotes,
      initialValue: defaultNotes,
    }),
  )
  releaseArgs.push('--notes', String(notes).trim() || defaultNotes)

  let upload = action === 'build-upload' || action === 'upload-only'
  let pushTag = false
  if (action === 'build' || action === 'dry-run') upload = false

  if (action === 'build-upload' || action === 'upload-only') {
    if (!process.env.GITCODE_TOKEN && !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      p.log.warn('未检测到 GITHUB_TOKEN / GITCODE_TOKEN，上传将跳过缺少 Token 的平台。')
      const continueWithoutToken = cancelIfNeeded(
        await p.confirm({ message: '是否仍继续（稍后手动设置 Token）？', initialValue: false }),
      )
      if (!continueWithoutToken) {
        p.cancel('已取消发版。')
        process.exit(0)
      }
    }
    if (action === 'build-upload') {
      pushTag = cancelIfNeeded(
        await p.confirm({
          message: '是否同时提交代码、打 tag 并 push 到 GitHub + GitCode？',
          initialValue: false,
        }),
      )
    }
    releaseArgs.push('--upload')
    if (pushTag) releaseArgs.push('--push')
  }

  const buildCommands = describeBuildPlan(platformSelection, { tauriBuildCommand: releaseConfigRaw.tauriBuildCommand || 'pnpm tauri build' }, releaseConfigRaw)
  const buildLabel =
    action === 'upload-only'
      ? '跳过构建'
      : action === 'dry-run'
        ? '预览（不构建）'
        : buildCommands.join('\n  ')

  p.note(
    [
      `操作：${actionLabel(action)}`,
      `平台：${platformSelectionLabel(platformSelection)}`,
      `版本：${versionLabel}`,
      `构建：${buildLabel}`,
      `上传：${upload ? '是（GitHub + GitCode）' : '否'}`,
      `推送 Git tag：${pushTag ? '是' : '否'}`,
      `说明：${String(notes).trim() || defaultNotes}`,
      '',
      '产物目录：releases/artifacts/',
      hasDesktopBuild(platformSelection) ? '更新清单：releases/latest.json' : '更新清单：跳过（无桌面产物）',
    ].join('\n'),
    '发版摘要',
  )

  const confirmed = cancelIfNeeded(
    await p.confirm({ message: '确认开始执行？', initialValue: true }),
  )
  if (!confirmed) {
    p.cancel('已取消发版。')
    process.exit(0)
  }

  runRelease(releaseArgs)
  p.outro(`发版完成：v${targetVersion}`)
}

function bumpPreview(version, part) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return version
  let major = Number(match[1])
  let minor = Number(match[2])
  let patch = Number(match[3])
  if (part === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (part === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

function actionLabel(action) {
  switch (action) {
    case 'build':
      return '仅打包'
    case 'build-upload':
      return '打包并上传'
    case 'upload-only':
      return '仅上传已有产物'
    case 'dry-run':
      return '预览流程'
    default:
      return action
  }
}

void main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
