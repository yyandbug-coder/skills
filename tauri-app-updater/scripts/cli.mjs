#!/usr/bin/env node
/**
 * tauri-app-updater —— 唯一入口。
 *
 * 老版本是十来个平级 .mjs 互相 spawn node 子进程串起来的，报错在哪一层全靠猜，
 * 而且每层都自己 `process.exit`。这里改成单进程 + 子命令：库层只抛 ReleaseError，
 * 退出码只在这一处决定。
 *
 *   cli.mjs [wizard]                 交互式发版（默认）
 *   cli.mjs release [options]        非交互流水线
 *   cli.mjs doctor [--fix-pubkey]    发版前体检
 *   cli.mjs manifest --version X     只生成各平台 latest.json
 *   cli.mjs upload --version X       只上传 releases/vX/
 *   cli.mjs verify [--version X]     发布后线上自检
 *   cli.mjs init                     把发版命令接进当前项目
 */
import { parseArgs } from './lib/args.mjs'
import { loadDotenv } from './lib/env.mjs'
import { loadReleaseConfig, resolveProjectRoot } from './lib/project.mjs'
import { log, red, ReleaseError, setLogScope } from './lib/log.mjs'

const COMMANDS = {
  wizard: () => import('./commands/wizard.mjs').then((m) => m.wizardCommand),
  release: () => import('./commands/release.mjs').then((m) => m.releaseCommand),
  doctor: () => import('./commands/doctor.mjs').then((m) => m.doctorCommand),
  manifest: () => import('./commands/manifest.mjs').then((m) => m.manifestCommand),
  upload: () => import('./commands/upload.mjs').then((m) => m.uploadCommand),
  verify: () => import('./commands/verify.mjs').then((m) => m.verifyCommand),
}

const USAGE = `用法：cli.mjs <command> [options]

命令
  wizard                    交互式发版向导（默认）
  release                   非交互发版流水线
  doctor                    发版前体检（签名密钥 / token / endpoint 可达性）
  manifest                  只生成各平台 latest.json
  upload                    只上传已有产物
  verify                    发布后线上自检
  init                      把发版命令接进当前项目

release 常用参数
  --part patch|minor|major  版本递增方式
  --set-version 0.1.13      指定版本号（不传也不 --part 则保持当前版本）
  --platform host,windows-x86_64,darwin-universal
  --upload                  上传到所有已配置平台
  --push                    提交版本号、打 tag 并 push 到所有远程
  --publish                 = --upload --push
  --replace                 远端同名附件先删后传（重发同一版本必需）
  --target github|gitcode   只处理指定平台
  --skip-build              跳过构建，直接用已有产物
  --skip-checks             跳过项目自定义校验（如 changelog 检查）
  --no-verify               跳过发布后线上自检
  --dry-run                 只打印计划
`

async function main() {
  const [rawCommand, ...rest] = process.argv.slice(2)

  if (rawCommand === '--help' || rawCommand === '-h' || rawCommand === 'help') {
    console.log(USAGE)
    return
  }

  const command = rawCommand && !rawCommand.startsWith('--') ? rawCommand : 'wizard'
  const argv = rawCommand && !rawCommand.startsWith('--') ? rest : process.argv.slice(2)
  const args = parseArgs(argv)

  const projectRoot = resolveProjectRoot()
  loadDotenv(projectRoot)

  if (command === 'init') {
    const { initCommand } = await import('./commands/init.mjs')
    return initCommand({ projectRoot, args })
  }

  const loader = COMMANDS[command]
  if (!loader) {
    console.error(`未知命令：${command}\n`)
    console.log(USAGE)
    process.exitCode = 1
    return
  }

  const config = loadReleaseConfig(projectRoot)
  const run = await loader()
  await run({ config, args })
}

main().catch((error) => {
  setLogScope('release')
  if (error instanceof ReleaseError) {
    log.fail(error.message)
    for (const hint of error.hints) log.detail(`→ ${hint}`)
    process.exit(error.exitCode)
  }
  console.error(red(`\n意外错误：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`))
  process.exit(1)
})
