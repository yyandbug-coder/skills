#!/usr/bin/env node
/**
 * Tauri 应用自动更新 Skill — 非交互发版底层。
 * 从任意 Tauri 项目根目录调用；脚本由 tauri-app-updater Skill 提供。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { createBuildEnv, getAppDisplayName, loadReleaseConfigRaw } from './lib/load-release-config.mjs'
import {
  collectDesktopBundleFiles,
  collectMobileArtifacts,
  mobileArtifactDestName,
} from './lib/release-artifacts.mjs'
import {
  describeBuildPlan,
  hasDesktopBuild,
  platformSelectionLabel,
} from './lib/release-platforms.mjs'
import { listConfiguredReleaseTargets, resolveReleaseBaseUrl } from './lib/release-targets.mjs'
import { getProjectVersion, getTauriReleaseUtils, setProjectVersion } from './lib/project-version.mjs'
import { getProjectRoot, getSkillRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const skillScripts = join(getSkillRoot(), 'scripts')
const releaseConfigRaw = loadReleaseConfigRaw(projectRoot)
const signingCfg = releaseConfigRaw.signing ?? {}
const appName = getAppDisplayName(projectRoot, releaseConfigRaw)

const args = process.argv.slice(2)

function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) return ''
  return args[index + 1]
}

function hasFlag(name) {
  return args.includes(name)
}

function shouldUseShell(command) {
  if (process.platform !== 'win32') return false
  return ['pnpm', 'npm', 'npx', 'yarn'].includes(command)
}

function run(command, commandArgs, options = {}) {
  console.log(`\n[release] $ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: shouldUseShell(command),
    env: createBuildEnv(projectRoot, options.env ?? {}),
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const dryRun = hasFlag('--dry-run')
const skipBump = hasFlag('--skip-bump')
const skipBuild = hasFlag('--skip-build')
const shouldPublish = hasFlag('--publish')
const shouldPush = hasFlag('--push') || shouldPublish
const shouldUpload = hasFlag('--upload') || shouldPublish
const partArg = readArg('--part') || process.env.TAURI_DMG_VERSION_BUMP_PART || 'patch'
const notes = readArg('--notes') || `${appName} release`
const setVersion = readArg('--set-version')
const tagFromEnv = process.env.GITCODE_TAG || readArg('--tag')

let platformSelection
try {
  platformSelection = readPlatformArgs(args)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (!['patch', 'minor', 'major'].includes(partArg)) {
  console.error('[release] --part 必须是 patch、minor 或 major')
  process.exit(1)
}

const { bump, config: releaseConfigLoader } = await getTauriReleaseUtils(projectRoot)
const releaseCfg = releaseConfigLoader.loadReleaseConfig(projectRoot)

let version = await getProjectVersion(projectRoot)
/** @type {string[]} */
let versionFiles = []

if (setVersion) {
  const result = await setProjectVersion(projectRoot, setVersion, { dryRun })
  console.log(`[release] 版本 ${result.from} → ${result.to}${dryRun ? '（dry-run）' : ''}`)
  version = result.to
  versionFiles = result.files
} else if (tagFromEnv) {
  const tagVersion = tagFromEnv.replace(/^v/, '')
  const result = await setProjectVersion(projectRoot, tagVersion, { dryRun })
  console.log(`[release] 按 tag 同步版本 ${result.from} → ${result.to}${dryRun ? '（dry-run）' : ''}`)
  version = result.to
  versionFiles = result.files
} else if (!skipBump) {
  const result = bump.bumpProjectVersion(projectRoot, { part: partArg, dryRun })
  console.log(`[release] 版本 ${result.from} → ${result.to}${dryRun ? '（dry-run）' : ''}`)
  for (const file of result.files) {
    console.log(`  ${dryRun ? '将更新' : '已更新'}：${file}`)
  }
  version = result.to
  versionFiles = result.files
} else {
  console.log(`[release] 跳过版本递增，当前版本 ${version}`)
}

const tagName = `v${version}`
const releaseTargets = listConfiguredReleaseTargets(releaseConfigRaw)
const primaryTarget = releaseTargets.includes('gitcode') ? 'gitcode' : releaseTargets[0] || 'gitcode'
const releaseBaseUrl =
  process.env.RELEASE_BASE_URL || resolveReleaseBaseUrl(primaryTarget, releaseConfigRaw, version)

if (releaseTargets.length === 0) {
  console.error('[release] release.config.json 需配置 github 或 gitcode')
  process.exit(1)
}

function resolveBuildCommands() {
  return describeBuildPlan(platformSelection, releaseCfg, releaseConfigRaw)
}

if (dryRun) {
  console.log('\n[release] dry-run 完成。将执行：')
  console.log(`  平台：${platformSelectionLabel(platformSelection)}`)
  for (const command of resolveBuildCommands()) {
    console.log(`  构建：${command}`)
  }
  if (hasDesktopBuild(platformSelection)) {
    console.log(`  生成：releases/latest.json（${releaseBaseUrl}）`)
  } else {
    console.log('  生成：跳过 latest.json（仅移动端）')
  }
  console.log(`  Tag：${tagName}`)
  if (shouldPush) console.log(`  Git：commit + tag ${tagName} + push`)
  if (shouldUpload) console.log(`  上传：${releaseTargets.join(' + ')}`)
  process.exit(0)
}

function toRepoRelativePath(absPath) {
  return relative(projectRoot, absPath).replace(/\\/g, '/')
}

function gitPushRelease(tag, commitFiles) {
  const tagCheck = spawnSync('git', ['rev-parse', tag], {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
  })
  if (tagCheck.status === 0) {
    console.error(`[release] tag ${tag} 已存在，请先删除或更换版本号`)
    process.exit(1)
  }

  const filesToAdd = [
    ...new Set([
      ...commitFiles.map((file) => toRepoRelativePath(file)),
      ...(existsSync(join(projectRoot, 'releases/latest.json')) ? ['releases/latest.json'] : []),
    ]),
  ]

  run('git', ['add', '--', ...filesToAdd])

  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: projectRoot,
    shell: false,
  })
  if (staged.status !== 0) {
    run('git', ['commit', '-m', `chore: release ${tag}`])
  } else {
    console.log('[release] 无待提交变更，跳过 commit')
  }

  run('git', ['tag', tag])
  run('node', [join(skillScripts, 'git-push-all.mjs'), '--tag', tag])
  console.log(`\n[release] 已推送 ${tag} 到所有远程仓库`)
}

if (!skipBuild) {
  if (hasDesktopBuild(platformSelection)) {
    const signingKeyPath = createBuildEnv(projectRoot).TAURI_SIGNING_PRIVATE_KEY
    if (!existsSync(signingKeyPath) && !String(signingKeyPath).includes('BEGIN')) {
      console.warn(`[release] 警告：未找到签名私钥 ${signingKeyPath}，构建产物可能没有 .sig 文件`)
    }
  }

  for (const buildCmd of resolveBuildCommands()) {
    const [buildBin, ...buildArgs] = buildCmd.split(/\s+/)
    run(buildBin, buildArgs)
  }
}

const bundleRoot = join(projectRoot, 'src-tauri/target/release/bundle')
const artifactDir = join(projectRoot, 'releases/artifacts')
mkdirSync(artifactDir, { recursive: true })

if (hasDesktopBuild(platformSelection)) {
  for (const file of collectDesktopBundleFiles(bundleRoot, platformSelection)) {
    cpSync(file, join(artifactDir, basename(file)), { force: true })
  }
}

if (hasMobileBuild(platformSelection)) {
  const mobileFiles = collectMobileArtifacts(projectRoot, releaseConfigRaw, {
    android: platformSelection.android,
    ios: platformSelection.ios,
  })
  if (mobileFiles.length === 0) {
    console.warn('[release] 未找到 Android/iOS 产物，请确认已执行 tauri android/ios build')
  }
  for (const file of mobileFiles) {
    const destName = mobileArtifactDestName(file, appName, version)
    cpSync(file, join(artifactDir, destName), { force: true })
    console.log(`[release] 已收集移动端产物：${destName}`)
  }
}

const desktopArtifacts = hasDesktopBuild(platformSelection)
  ? collectDesktopBundleFiles(bundleRoot, platformSelection).filter((file) => !file.endsWith('.sig'))
  : []

if (desktopArtifacts.length > 0) {
  run('node', [
    join(skillScripts, 'generate-latest-json.mjs'),
    '--version',
    version,
    '--notes',
    notes,
    '--bundle-root',
    bundleRoot,
    '--target',
    primaryTarget,
  ], {
    env: { RELEASE_BASE_URL: releaseBaseUrl, RELEASE_TARGET: primaryTarget },
  })

  cpSync(join(projectRoot, 'releases/latest.json'), join(artifactDir, 'latest.json'), { force: true })
} else {
  console.log('[release] 无桌面产物，跳过 latest.json（移动端包将直接上传到 Release）')
}

if (hasMobileBuild(platformSelection)) {
  run('node', [join(skillScripts, 'generate-mobile-update-config.mjs')])
}

console.log(`\n[release] 发版平台：${platformSelectionLabel(platformSelection)}`)
console.log('\n[release] 发版本地产物：')
for (const file of readdirSync(artifactDir)) {
  console.log(`  releases/artifacts/${file}`)
}

if (shouldPush) {
  gitPushRelease(tagName, versionFiles)
} else {
  console.log(`\n[release] 下一步：`)
  console.log(`  pnpm release:publish   # 或 pnpm release:cli --push --upload`)
}

if (shouldUpload) {
  const hasGithubToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
  const hasGitcodeToken = Boolean(process.env.GITCODE_TOKEN)
  if (!hasGithubToken && !hasGitcodeToken) {
    console.error('\n[release] --upload 需要设置 GITHUB_TOKEN（或 GH_TOKEN）和/或 GITCODE_TOKEN')
    process.exit(1)
  }
  run('node', [
    join(skillScripts, 'upload-release.mjs'),
    '--tag',
    tagName,
    '--version',
    version,
    '--name',
    `${appName} ${tagName}`,
    '--body',
    notes,
    '--dir',
    'releases/artifacts',
    '--bundle-root',
    bundleRoot,
    '--skip-json',
  ])
  console.log(`\n[release] 已上传到所有可用平台：${tagName}`)
}

console.log(`\n[release] 完成：${tagName}`)
