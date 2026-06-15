#!/usr/bin/env node
/**
 * 创建 GitHub Release 并上传产物（Skill 内置，从项目根调用）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { getAppDisplayName, loadReleaseConfigRaw } from './lib/load-release-config.mjs'
import { shouldIncludeReleaseAsset } from './lib/release-artifacts.mjs'
import { getGithubConfig } from './lib/release-targets.mjs'
import { getProjectRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const releaseConfig = loadReleaseConfigRaw(projectRoot)
const githubCfg = getGithubConfig(releaseConfig)
const appName = getAppDisplayName(projectRoot, releaseConfig)

const args = process.argv.slice(2)

function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) return ''
  return args[index + 1]
}

const tagName = readArg('--tag') || process.env.GITHUB_TAG || process.env.GITCODE_TAG
const releaseName = readArg('--name') || `${appName} ${tagName}`
const releaseBody = readArg('--body') || `Release ${tagName}`
const assetsDir = join(projectRoot, readArg('--dir') || 'releases/artifacts')

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const { owner, repo, apiUrl, defaultBranch } = githubCfg
const releaseVersion = tagName?.replace(/^v/, '') ?? ''

if (!token) {
  console.error('[github-upload] 缺少环境变量 GITHUB_TOKEN 或 GH_TOKEN')
  process.exit(1)
}
if (!tagName) {
  console.error('[github-upload] 缺少 --tag 或 GITHUB_TAG')
  process.exit(1)
}
if (!owner || !repo) {
  console.error('[github-upload] 缺少 GITHUB_OWNER / GITHUB_REPO 或 release.config.json 配置')
  process.exit(1)
}

function resolveDefaultBranch() {
  if (defaultBranch) return defaultBranch
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  })
  return result.stdout?.trim() || 'master'
}

const targetBranch = resolveDefaultBranch()

async function githubRequest(method, path, body, headers = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body,
  })
  const text = await response.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text }
    }
  }
  return { ok: response.ok, status: response.status, json, text }
}

async function getOrCreateRelease() {
  const existing = await githubRequest(
    'GET',
    `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`,
  )
  if (existing.ok && existing.json) {
    console.log(`[github-upload] Release 已存在，继续上传：${tagName}`)
    return existing.json
  }

  const payload = {
    tag_name: tagName,
    name: releaseName,
    body: releaseBody,
    target_commitish: targetBranch,
  }

  const created = await githubRequest(
    'POST',
    `/repos/${owner}/${repo}/releases`,
    JSON.stringify(payload),
    { 'Content-Type': 'application/json; charset=utf-8' },
  )

  if (created.ok && created.json) {
    console.log(`[github-upload] Release 已创建：${tagName}`)
    return created.json
  }

  console.error(`[github-upload] 创建 Release 失败（HTTP ${created.status}）`)
  console.error(created.text)
  process.exit(1)
}

async function uploadFile(release, filePath) {
  const filename = basename(filePath)
  const uploadUrl = String(release.upload_url).replace(
    /\{[^}]*\}$/,
    `?name=${encodeURIComponent(filename)}`,
  )

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
    },
    body: readFileSync(filePath),
  })

  if (!response.ok) {
    const body = await response.text()
    if (/already_exists|already exists/i.test(body)) {
      console.log(`[github-upload] 已存在，跳过：${filename}`)
      return
    }
    console.error(`[github-upload] 上传失败：${filename}（HTTP ${response.status}）`)
    console.error(body)
    process.exit(1)
  }

  console.log(`[github-upload] 已上传：${filename}`)
}

function listAssetFiles() {
  return readdirSync(assetsDir)
    .map((name) => join(assetsDir, name))
    .filter((path) => statSync(path).isFile())
    .filter((path) => shouldIncludeReleaseAsset(basename(path), releaseVersion))
}

const files = listAssetFiles()
if (files.length === 0) {
  console.error(`[github-upload] 目录为空：${assetsDir}`)
  process.exit(1)
}

const release = await getOrCreateRelease()
const nonJson = files.filter((file) => !/\.json$/i.test(file))
const jsonFiles = files.filter((file) => /\.json$/i.test(file))

for (const file of nonJson) await uploadFile(release, file)
for (const file of jsonFiles) await uploadFile(release, file)

console.log(`[github-upload] 全部上传完成：${tagName}`)
