#!/usr/bin/env node
/**
 * tauri-app-updater 安装器。
 *
 * 为什么不直接依赖 `npx skills add`：那是第三方 CLI，装不装得上要看网络与它的版本，
 * 而这个 Skill 的 wrapper 只认一件事——`~/.agents/skills/tauri-app-updater/scripts/cli.mjs`
 * 存不存在。与其绕一圈，不如自己把文件放到位并当场验证能跑。
 *
 * 三种用法：
 *
 *   # 1. 远程安装（没有本地检出时）
 *   curl -fsSL https://raw.githubusercontent.com/yyandbug-coder/skills/master/tauri-app-updater/install.mjs | node
 *
 *   # 2. 本地检出 → 复制安装
 *   node install.mjs
 *
 *   # 3. 本地检出 → 符号链接（开发 Skill 本身时用，改完立刻生效）
 *   node install.mjs --link
 *
 * Windows 上第 3 种需要开发者模式或管理员权限，做不到会自动退回复制并提示。
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = 'tauri-app-updater'
const REPO = 'https://github.com/yyandbug-coder/skills.git'
const BRANCH = 'master'
const ENTRY = join('scripts', 'cli.mjs')

/** 只复制这些；.git、node_modules、编辑器杂物一律不进安装目录。 */
const PAYLOAD = ['SKILL.md', 'README.md', 'reference.md', 'pitfalls.md', 'scripts', 'templates', 'install.mjs']

const args = process.argv.slice(2)
const useLink = args.includes('--link')
const targetRoot = readOption('--dir') || join(homedir(), '.agents', 'skills')
const destination = join(targetRoot, SKILL)

/** @param {string} name */
function readOption(name) {
  const index = args.indexOf(name)
  return index !== -1 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : ''
}

/** @param {string} message */
function info(message) {
  console.log(`[install] ${message}`)
}

/** @param {string} message */
function fail(message) {
  console.error(`[install] ✗ ${message}`)
  process.exit(1)
}

/**
 * 通过管道执行时（`curl … | node`）没有真实文件路径，`import.meta.url` 会是
 * `[stdin]` 之类的东西——这时只能走远程克隆。
 */
function localCheckout() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return existsSync(join(here, ENTRY)) ? here : ''
  } catch {
    return ''
  }
}

/** @returns {{ dir: string, cleanup: () => void }} */
function fetchRemote() {
  const probe = spawnSync('git', ['--version'], { stdio: 'ignore' })
  if (probe.status !== 0) fail('需要 git 才能远程安装；或先克隆仓库再执行 node install.mjs')

  const workdir = mkdtempSync(join(tmpdir(), 'skill-install-'))
  info(`克隆 ${REPO} (${BRANCH})`)
  const cloned = spawnSync(
    'git',
    ['clone', '--depth', '1', '--branch', BRANCH, '--quiet', REPO, workdir],
    { stdio: 'inherit' },
  )
  if (cloned.status !== 0) {
    rmSync(workdir, { recursive: true, force: true })
    fail('克隆失败，检查网络或代理')
  }

  const skillDir = join(workdir, SKILL)
  if (!existsSync(join(skillDir, ENTRY))) {
    rmSync(workdir, { recursive: true, force: true })
    fail(`仓库里没有 ${SKILL}/${ENTRY}`)
  }
  return { dir: skillDir, cleanup: () => rmSync(workdir, { recursive: true, force: true }) }
}

/** 已存在的安装（含指向别处的符号链接）先整个清掉，避免新旧文件混在一起。 */
function clearDestination() {
  if (!existsSync(destination) && !isSymlink(destination)) return

  if (isSymlink(destination)) {
    info(`移除旧符号链接（→ ${safeReadlink(destination)}）`)
    unlinkSync(destination)
    return
  }
  info('移除旧安装')
  rmSync(destination, { recursive: true, force: true })
}

/** @param {string} path */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** @param {string} path */
function safeReadlink(path) {
  try {
    return readlinkSync(path)
  } catch {
    return '?'
  }
}

/** @param {string} source */
function installByCopy(source) {
  mkdirSync(destination, { recursive: true })
  for (const entry of PAYLOAD) {
    const from = join(source, entry)
    if (!existsSync(from)) continue
    cpSync(from, join(destination, entry), { recursive: true, force: true })
  }
  info(`已复制到 ${destination}`)
}

/** @param {string} source */
function installByLink(source) {
  mkdirSync(dirname(destination), { recursive: true })
  try {
    symlinkSync(resolve(source), destination, 'junction')
    info(`已链接 ${destination} → ${resolve(source)}`)
    return true
  } catch (error) {
    console.warn(`[install] 符号链接失败（${error instanceof Error ? error.message : error}），改为复制`)
    console.warn('[install] Windows 需要开发者模式或管理员权限才能建链接')
    return false
  }
}

function verify() {
  const entry = join(destination, ENTRY)
  if (!existsSync(entry)) fail(`安装后仍找不到 ${entry}`)

  const result = spawnSync(process.execPath, [entry, '--help'], { stdio: 'pipe', encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout)
    fail('安装完成但无法运行，见上面的输出')
  }
  info('✓ 验证通过')
}

// ── 主流程 ─────────────────────────────────────────────────────────────

const checkout = localCheckout()
let cleanup = () => {}
let source = checkout

if (!source) {
  if (useLink) fail('--link 需要本地检出；请先 git clone 再执行')
  const remote = fetchRemote()
  source = remote.dir
  cleanup = remote.cleanup
} else {
  info(`使用本地检出 ${source}`)
}

try {
  // 已经装成指向本检出的链接时，重复安装是无意义的自我复制。
  if (checkout && isSymlink(destination) && realpathSync(destination) === realpathSync(checkout)) {
    info('已链接到当前检出，无需重装')
    verify()
    process.exit(0)
  }

  clearDestination()
  const linked = useLink && installByLink(source)
  if (!linked) {
    installByCopy(source)
    // 从本地检出复制安装时，之后改检出是**不会生效**的——安装目录是一份快照。
    // 一边开发 Skill 一边用它发版的人最容易栽在这：改了半天没反应，还以为代码有问题。
    if (checkout) {
      console.warn('[install] 注意：这是一份拷贝，之后修改检出不会自动生效')
      console.warn('[install] 开发 Skill 本身请改用：node install.mjs --link')
    }
  }
  verify()
} finally {
  cleanup()
}

console.log('')
info('下一步：在你的 Tauri 项目根目录执行')
console.log(`  node ${join(destination, ENTRY)} init`)
console.log('')
info('之后该项目用 pnpm release / release:doctor / release:verify 即可')
