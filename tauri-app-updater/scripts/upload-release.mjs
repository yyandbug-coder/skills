#!/usr/bin/env node
/**
 * 将产物上传到所有已配置的发版平台（GitHub + GitCode）。
 */
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { getAppDisplayName, loadReleaseConfigRaw } from './lib/load-release-config.mjs'
import { listConfiguredReleaseTargets } from './lib/release-targets.mjs'
import { getProjectRoot, getSkillRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const skillScripts = join(getSkillRoot(), 'scripts')
const releaseConfig = loadReleaseConfigRaw(projectRoot)
const appName = getAppDisplayName(projectRoot, releaseConfig)

const args = process.argv.slice(2)

function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) return ''
  return args[index + 1]
}

function hasFlag(name) {
  return args.includes(name)
}

function runNode(scriptName, scriptArgs, extraEnv = {}) {
  const result = spawnSync('node', [join(skillScripts, scriptName), ...scriptArgs], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const tagName = readArg('--tag') || process.env.GITCODE_TAG || process.env.GITHUB_TAG
const releaseName = readArg('--name') || `${appName} ${tagName}`
const releaseBody = readArg('--body') || `Release ${tagName}`
const assetsDir = readArg('--dir') || 'releases/artifacts'
const version = readArg('--version') || tagName?.replace(/^v/, '')
const notes = readArg('--notes') || releaseBody
const bundleRoot = readArg('--bundle-root') || join(projectRoot, 'src-tauri/target/release/bundle')
const onlyTarget = readArg('--target')
const skipJson = hasFlag('--skip-json')

if (!tagName) {
  console.error('[upload-release] 缺少 --tag')
  process.exit(1)
}
if (!version) {
  console.error('[upload-release] 缺少 --version 或有效 --tag')
  process.exit(1)
}

/** @type {Array<'github' | 'gitcode'>} */
let targets = listConfiguredReleaseTargets(releaseConfig)
if (onlyTarget) {
  if (!['github', 'gitcode'].includes(onlyTarget)) {
    console.error('[upload-release] --target 必须是 github 或 gitcode')
    process.exit(1)
  }
  targets = [onlyTarget]
}

if (targets.length === 0) {
  console.error('[upload-release] release.config.json 未配置 github 或 gitcode')
  process.exit(1)
}

for (const target of targets) {
  const token =
    target === 'github'
      ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      : process.env.GITCODE_TOKEN

  if (!token) {
    console.error(
      `[upload-release] 跳过 ${target}：缺少 ${target === 'github' ? 'GITHUB_TOKEN / GH_TOKEN' : 'GITCODE_TOKEN'}`,
    )
    continue
  }

  if (!skipJson) {
    console.log(`\n[upload-release] 生成 ${target} 版 latest.json`)
    runNode('generate-latest-json.mjs', [
      '--version',
      version,
      '--notes',
      notes,
      '--bundle-root',
      bundleRoot,
      '--target',
      target,
    ])
    cpSync(join(projectRoot, 'releases/latest.json'), join(projectRoot, assetsDir, 'latest.json'), {
      force: true,
    })
  }

  const uploadScript = target === 'github' ? 'github-upload-release.mjs' : 'gitcode-upload-release.mjs'
  console.log(`\n[upload-release] 上传到 ${target}`)
  runNode(uploadScript, [
    '--tag',
    tagName,
    '--name',
    releaseName,
    '--body',
    releaseBody,
    '--dir',
    assetsDir,
  ])
}

console.log('\n[upload-release] 全部平台处理完成')
