/**
 * `cli.mjs init` —— 把发版命令接进当前 Tauri 项目。
 *
 * 只做三件事：写 wrapper、写 release.config.json、合并 package.json scripts。
 * **不再往 src/ 里塞任何模板文件**——老版本硬写 `src/lib/`、`src/hooks/`，
 * 与各项目自己的目录规范冲突，而且是纯桌面项目用不到的移动端代码。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log, setLogScope } from '../lib/log.mjs'
import { detectPackageManager, installCommand, runScriptCommand, tauriCommand } from '../lib/package-manager.mjs'
import { readJson } from '../lib/project.mjs'

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

const PACKAGE_SCRIPTS = {
  release: 'node scripts/updater-skill.mjs',
  'release:cli': 'node scripts/updater-skill.mjs release',
  'release:doctor': 'node scripts/updater-skill.mjs doctor',
  'release:manifest': 'node scripts/updater-skill.mjs manifest',
  'release:upload': 'node scripts/updater-skill.mjs upload',
  'release:verify': 'node scripts/updater-skill.mjs verify',
}

/**
 * @param {object} context
 * @param {string} context.projectRoot
 * @param {import('../lib/args.mjs').Args} context.args
 */
export function initCommand({ projectRoot, args }) {
  setLogScope('init')

  const wrapperPath = join(projectRoot, 'scripts', 'updater-skill.mjs')
  mkdirSync(dirname(wrapperPath), { recursive: true })
  writeFileSync(wrapperPath, readFileSync(join(skillRoot, 'templates/updater-skill.mjs'), 'utf8'), 'utf8')
  log.ok(`已写入 scripts/updater-skill.mjs`)

  const manager = detectPackageManager(projectRoot)
  log.info(`包管理器：${manager}`)

  const configPath = join(projectRoot, 'release.config.json')
  if (existsSync(configPath) && !args.has('force')) {
    log.info('release.config.json 已存在，保留（--force 覆盖）')
  } else {
    const template = readJson(join(skillRoot, 'templates/release.config.json'))
    const tauriConfigPath = join(projectRoot, 'src-tauri/tauri.conf.json')
    if (existsSync(tauriConfigPath)) {
      template.appName = readJson(tauriConfigPath).productName || template.appName
    }
    // 按本项目实际的包管理器写默认构建命令，而不是照抄模板里的 pnpm。
    template.build = {
      default: tauriCommand(manager, ['build']),
      'darwin-universal': tauriCommand(manager, ['build', '--target', 'universal-apple-darwin']),
    }
    writeFileSync(configPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8')
    log.ok('已写入 release.config.json（请填 owner/repo）')
  }

  const packagePath = join(projectRoot, 'package.json')
  const pkg = readJson(packagePath)
  pkg.scripts = { ...pkg.scripts, ...PACKAGE_SCRIPTS }
  pkg.devDependencies = { '@clack/prompts': '^1.6.0', ...(pkg.devDependencies ?? {}) }
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  log.ok('已合并 package.json scripts')

  console.log('')
  log.info('下一步：')
  log.detail(`1. ${installCommand(manager)}`)
  log.detail('2. 编辑 release.config.json：填 github / gitcode 的 owner、repo')
  log.detail(`3. 生成签名密钥：${tauriCommand(manager, ['signer', 'generate', '-w', '.secrets/app.key', '--force', '--ci'])}`)
  log.detail('4. 把 .secrets/ 与 .env 加进 .gitignore')
  log.detail(`5. 自动补 updater 配置并体检：${runScriptCommand(manager, 'release:doctor', ['--fix'])}`)
  log.detail(`6. 发版：${runScriptCommand(manager, 'release')}`)
}
