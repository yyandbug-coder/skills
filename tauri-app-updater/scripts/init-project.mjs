#!/usr/bin/env node
/**
 * 将 Skill 发版命令接入当前 Tauri 项目。
 *
 * 用法（安装 Skill 后，在项目根目录）：
 *   node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { getSkillRoot } from './lib/skill-paths.mjs'

const projectRoot = process.cwd()
const skillRoot = getSkillRoot()

const wrapperPath = join(projectRoot, 'scripts', 'updater-skill.mjs')
const wrapperTemplate = join(skillRoot, 'templates', 'updater-skill.mjs')
const configPath = join(projectRoot, 'release.config.json')
const packagePath = join(projectRoot, 'package.json')

const defaultConfig = {
  appName: 'Your App',
  versionBump: 'pre',
  tauriBuildCommand: 'pnpm tauri build',
  desktop: {
    windowsBuildCommand: 'pnpm tauri build -- --target x86_64-pc-windows-msvc',
    macosBuildCommand: 'pnpm tauri build -- --target aarch64-apple-darwin',
    linuxBuildCommand: 'pnpm tauri build -- --target x86_64-unknown-linux-gnu',
  },
  signing: {
    privateKeyPath: '~/.tauri/your-app.key',
    privateKeyPassword: '',
    envKeyVar: 'YOUR_APP_SIGNING_PRIVATE_KEY',
    envPasswordVar: 'YOUR_APP_SIGNING_PRIVATE_KEY_PASSWORD',
  },
  github: {
    owner: 'YOUR_GITHUB_OWNER',
    repo: 'YOUR_REPO_NAME',
    defaultBranch: 'master',
  },
  gitcode: {
    owner: 'YOUR_GITCODE_OWNER',
    repo: 'YOUR_REPO_NAME',
    apiUrl: 'https://api.gitcode.com/api/v5',
    defaultBranch: 'master',
  },
  mobile: {
    androidBuildCommand: 'pnpm tauri android build -- --apk --aab',
    iosBuildCommand: 'pnpm tauri ios build',
    artifactDirs: [],
    update: {
      target: 'gitcode',
      versionSource: 'latest-json',
      releasePageUrl: '',
      versionCheckUrl: '',
      releaseApiUrl: '',
    },
  },
}

const packageScripts = {
  release: 'node scripts/updater-skill.mjs release-interactive.mjs',
  'release:interactive': 'node scripts/updater-skill.mjs release-interactive.mjs',
  'create:release': 'node scripts/updater-skill.mjs release-interactive.mjs',
  'release:cli': 'node scripts/updater-skill.mjs release.mjs',
  'release:publish': 'node scripts/updater-skill.mjs release.mjs --publish',
  'release:dry-run': 'node scripts/updater-skill.mjs release.mjs --dry-run',
  'release:upload': 'node scripts/updater-skill.mjs upload-release.mjs',
  'release:upload:github': 'node scripts/updater-skill.mjs github-upload-release.mjs',
  'release:upload:gitcode': 'node scripts/updater-skill.mjs gitcode-upload-release.mjs',
  'git:push-all': 'node scripts/updater-skill.mjs git-push-all.mjs',
  'release:json': 'node scripts/updater-skill.mjs generate-latest-json.mjs',
  'release:mobile-config': 'node scripts/updater-skill.mjs generate-mobile-update-config.mjs',
}

const templateFiles = [
  'src/lib/mobile-update.ts',
  'src/hooks/useMobileUpdate.ts',
]

function copyTemplateIfMissing(relativePath) {
  const dest = join(projectRoot, relativePath)
  if (existsSync(dest)) return false

  const src = join(skillRoot, 'templates', relativePath)
  if (!existsSync(src)) return false

  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8')
  console.log(`[init] 已写入 ${relativePath}`)
  return true
}

function runGenerateMobileConfig() {
  const scriptPath = join(skillRoot, 'scripts', 'generate-mobile-update-config.mjs')
  const result = spawnSync('node', [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })
  if (result.status !== 0) {
    console.warn('[init] 生成 mobile-update-config 失败，请稍后执行 pnpm release:mobile-config')
  }
}

mkdirSync(join(projectRoot, 'scripts'), { recursive: true })
writeFileSync(wrapperPath, readFileSync(wrapperTemplate, 'utf8'), 'utf8')
console.log(`[init] 已写入 ${wrapperPath}`)

if (!existsSync(configPath)) {
  writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8')
  console.log(`[init] 已写入 ${configPath}（请修改 owner/repo/私钥路径）`)
} else {
  console.log(`[init] 保留已有 ${configPath}`)
}

for (const relativePath of templateFiles) {
  copyTemplateIfMissing(relativePath)
}

if (!existsSync(packagePath)) {
  console.error('[init] 未找到 package.json，请在项目根目录执行')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
pkg.scripts = { ...pkg.scripts, ...packageScripts }

const deps = pkg.dependencies ?? {}
if (!deps['@tauri-apps/plugin-opener']) deps['@tauri-apps/plugin-opener'] = '^2'
pkg.dependencies = deps

const devDeps = pkg.devDependencies ?? {}
if (!devDeps['@clack/prompts']) devDeps['@clack/prompts'] = '^1.5.1'
if (!devDeps['tauri-release-utils']) devDeps['tauri-release-utils'] = '^0.1.1'
pkg.devDependencies = devDeps

writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
console.log('[init] 已合并 package.json scripts / dependencies')

runGenerateMobileConfig()

console.log(`[init] Skill 路径：${skillRoot}`)
console.log('\n下一步：')
console.log('  1. 编辑 release.config.json（含 mobile.update）')
console.log('  2. pnpm install')
console.log('  3. 在 capabilities 中加入 opener:default（见 templates/capabilities/mobile-update.json）')
console.log('  4. pnpm create:release')
