#!/usr/bin/env node
/**
 * 根据 Tauri 构建产物生成 latest.json（Skill 内置，从项目根调用）。
 */
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

import { getAppDisplayName, loadReleaseConfigRaw } from './lib/load-release-config.mjs'
import { resolveReleaseBaseUrl } from './lib/release-targets.mjs'
import { getProjectRoot } from './lib/skill-paths.mjs'

const projectRoot = getProjectRoot()
const tauriConfig = JSON.parse(readFileSync(join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8'))
const releaseConfigRaw = loadReleaseConfigRaw(projectRoot)
const appName = getAppDisplayName(projectRoot, releaseConfigRaw)

const args = process.argv.slice(2)
function readArg(name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) return ''
  return args[index + 1]
}

const version = readArg('--version') || tauriConfig.version
const notes = readArg('--notes') || `${appName} ${version}`
const bundleRoot = readArg('--bundle-root') || join(projectRoot, 'src-tauri/target/release/bundle')
const target = readArg('--target') || process.env.RELEASE_TARGET || 'gitcode'
const releaseBaseUrl =
  process.env.RELEASE_BASE_URL ?? resolveReleaseBaseUrl(target, releaseConfigRaw, version)

function readSig(path) {
  return readFileSync(path, 'utf8').trim()
}

function collectFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(fullPath, acc)
    else acc.push(fullPath)
  }
  return acc
}

function findAllBundlePairs(files, extension) {
  return files
    .filter((file) => file.endsWith(extension) && !file.endsWith('.sig'))
    .map((bundle) => {
      const sig = `${bundle}.sig`
      if (!existsSync(sig)) return null
      return { bundle, sig, name: basename(bundle) }
    })
    .filter((item) => item !== null)
}

function toReleaseUrl(fileName) {
  if (target === 'github') {
    return `${releaseBaseUrl}/${encodeURIComponent(fileName)}`
  }
  return `${releaseBaseUrl}/${encodeURIComponent(fileName)}/download`
}

function detectMacPlatform(fileName) {
  const lower = fileName.toLowerCase()
  if (lower.includes('aarch64') || lower.includes('arm64')) return 'darwin-aarch64'
  if (lower.includes('x64') || lower.includes('x86_64') || lower.includes('intel')) return 'darwin-x86_64'
  if (lower.includes('universal')) return 'darwin-universal'
  return null
}

/** @type {Record<string, { url: string, signature: string }>} */
const platforms = {}
const bundleFiles = collectFiles(bundleRoot)

for (const pair of findAllBundlePairs(bundleFiles, '.exe')) {
  platforms['windows-x86_64'] = { url: toReleaseUrl(pair.name), signature: readSig(pair.sig) }
}

for (const pair of findAllBundlePairs(bundleFiles, '.app.tar.gz')) {
  const platform = detectMacPlatform(pair.name)
  const entry = { url: toReleaseUrl(pair.name), signature: readSig(pair.sig) }
  if (platform === 'darwin-universal') {
    platforms['darwin-aarch64'] = entry
    platforms['darwin-x86_64'] = entry
  } else if (platform) {
    platforms[platform] = entry
  } else {
    console.warn(`[generate-latest-json] 无法识别 macOS 架构，已跳过：${pair.name}`)
  }
}

for (const pair of findAllBundlePairs(bundleFiles, '.AppImage')) {
  platforms['linux-x86_64'] = { url: toReleaseUrl(pair.name), signature: readSig(pair.sig) }
}

if (Object.keys(platforms).length === 0) {
  console.error('[generate-latest-json] 未找到任何 .sig 构建产物，请先执行 pnpm tauri build')
  process.exit(1)
}

const manifest = { version, notes, pub_date: new Date().toISOString(), platforms }
const outDir = join(projectRoot, 'releases')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'latest.json')
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[generate-latest-json] 已写入 ${outPath}`)
console.log(JSON.stringify(manifest, null, 2))
