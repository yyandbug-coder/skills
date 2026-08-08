/**
 * `cli.mjs release` —— 非交互发版流水线。向导只是它的前端。
 *
 * 阶段固定，每一步失败都在**造成外部副作用之前**中止：
 *   体检 → 项目校验(changelog) → 定版本 → 构建 → 收产物 → 验签名
 *   → 逐目标生成 manifest → git tag/push → 逐目标上传 → 线上自检
 *
 * 版本号在「已 push 或已上传」之前失败会自动回退；之后失败不回退——本地和远端
 * 不一致比版本号超前更难收拾。
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { assertHealthy } from './doctor.mjs'
import { uploadToTarget } from './upload.mjs'
import { log, ReleaseError, setLogScope } from '../lib/log.mjs'
import { bumpVersion, readProjectVersion, resolveArtifactDir, toRelative, writeProjectVersion } from '../lib/project.mjs'
import { collectArtifacts, resolvePlatforms } from '../lib/platforms.mjs'
import { auditManifest, buildManifest, collectUpdaterEntries, writeManifest } from '../lib/manifest.mjs'
import { createSigningEnv, readConfiguredPubkey, verifySignatureKeys } from '../lib/signing.mjs'
import { commitAndTag, pushAll } from '../lib/git.mjs'
import { interpolate, resolveNotesFromProject, runProjectChecks } from '../lib/notes.mjs'
import { listTargets, pickPrimaryTarget, tagFor } from '../lib/targets.mjs'
import { tauriCommand } from '../lib/package-manager.mjs'
import { printReport } from '../lib/report.mjs'
import { runCommand } from '../lib/shell.mjs'
import { verifyPublishedRelease } from '../lib/doctor.mjs'

/** 上传时不作为普通附件的中间产物。 */
const MANIFEST_DIR = '.manifests'

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 * @param {import('../lib/args.mjs').Args} context.args
 */
export async function releaseCommand({ config, args }) {
  setLogScope('release')

  const plan = resolvePlan(config, args)
  if (args.has('dry-run')) return printPlan(config, plan)

  let versionRolledBack = false
  let versionLocked = false

  try {
    if (!plan.skipDoctor) {
      printReport(await assertHealthy(config), '发版前体检')
    }

    // 版本号先定下来，changelog 校验才知道该查哪一版。
    if (plan.targetVersion !== plan.currentVersion) {
      const result = writeProjectVersion(config, plan.targetVersion)
      log.ok(`版本 ${result.from} → ${result.to}`)
      for (const file of result.files) log.detail(toRelative(config.projectRoot, file))
      plan.versionFiles = result.files
    } else {
      log.info(`保持当前版本 v${plan.currentVersion}`)
      plan.versionFiles = []
    }

    if (!plan.skipChecks) runProjectChecks(config, plan.targetVersion)
    const notes = plan.notes || resolveNotesFromProject(config, plan.targetVersion) || defaultNotes(config, plan.targetVersion)

    if (!plan.skipBuild) build(config, plan)

    const builds = collectBuilds(config, plan)
    const artifactDir = stageArtifacts(config, plan, builds)
    verifySignatures(config, builds)

    const manifests = writeManifests({ config, plan, builds, notes, artifactDir })

    if (plan.push) {
      const tag = tagFor(plan.targetVersion)
      commitAndTag({
        cwd: config.projectRoot,
        tag,
        files: [...plan.versionFiles, join(config.projectRoot, config.releaseDir, 'latest.json')],
      })
      const remotes = pushAll({ cwd: config.projectRoot, tag })
      versionLocked = true
      log.ok(`已推送 ${tag} 到：${remotes.join('、')}`)
    }

    if (plan.upload) {
      await upload({ config, plan, artifactDir, manifests, notes })
      versionLocked = true
    }

    if (plan.upload && !plan.skipVerify) {
      log.step('线上自检')
      const results = await verifyPublishedRelease({ config, version: plan.targetVersion })
      const { failed } = printReport(results, `${config.appName} v${plan.targetVersion} 发布验证`)
      if (failed > 0) {
        throw new ReleaseError('线上验证未通过：客户端很可能检测到新版本但下载失败', {
          hints: ['核对 Release 附件是否齐全，补传后重跑：cli.mjs verify'],
        })
      }
    }

    log.ok(`发版完成：v${plan.targetVersion}`)
    if (!plan.upload) {
      log.detail(`产物在 ${toRelative(config.projectRoot, artifactDir)}/，上传：cli.mjs upload --version ${plan.targetVersion}`)
    }
  } catch (error) {
    if (!versionLocked && plan.versionFiles?.length > 0 && plan.targetVersion !== plan.currentVersion) {
      try {
        writeProjectVersion(config, plan.currentVersion)
        versionRolledBack = true
      } catch {
        log.fail(`版本号回退失败，请手动改回 ${plan.currentVersion}`)
      }
    }
    if (versionRolledBack) log.warn(`已回退版本号至 v${plan.currentVersion}`)
    throw error
  }
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {import('../lib/args.mjs').Args} args
 */
function resolvePlan(config, args) {
  const currentVersion = readProjectVersion(config)

  let targetVersion = currentVersion
  const setVersion = args.get('set-version')
  const part = args.get('part')
  if (setVersion) {
    targetVersion = setVersion.replace(/^v/, '')
  } else if (part) {
    if (!['patch', 'minor', 'major'].includes(part)) {
      throw new ReleaseError('--part 只能是 patch / minor / major')
    }
    targetVersion = bumpVersion(currentVersion, /** @type {'patch'|'minor'|'major'} */ (part))
  }

  return {
    currentVersion,
    targetVersion,
    platforms: resolvePlatforms(args.list('platform')),
    notes: args.get('notes'),
    push: args.has('push') || args.has('publish'),
    upload: args.has('upload') || args.has('publish'),
    replaceAssets: args.has('replace'),
    skipBuild: args.has('skip-build'),
    skipChecks: args.has('skip-checks'),
    skipDoctor: args.has('skip-doctor'),
    skipVerify: args.has('no-verify'),
    onlyTargets: args.list('target'),
    /** @type {string[]} */
    versionFiles: [],
  }
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {string} version
 */
function defaultNotes(config, version) {
  return `${config.appName} v${version}`
}

/**
 * 平台构建命令：优先 release.config.json 的 build[平台id]，否则按 rust triple 拼默认命令。
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {import('../lib/platforms.mjs').PlatformDescriptor} platform
 */
export function buildCommandFor(config, platform) {
  const configured = config.buildCommands[platform.id] ?? config.buildCommands.default
  if (typeof configured === 'string' && configured.trim()) {
    return interpolate(configured.trim(), { target: platform.rustTarget ?? '', platform: platform.id })
  }
  // 没配就按本项目实际用的包管理器拼——硬编码 pnpm 会让 npm / yarn / bun 项目开箱即坏。
  const args = platform.rustTarget ? ['build', '--target', platform.rustTarget] : ['build']
  return tauriCommand(config.packageManager, args)
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof resolvePlan>} plan
 */
function build(config, plan) {
  // 签名私钥在这里统一注入：项目不再需要自己包一层 with-signing-env 脚本。
  const { env, key } = createSigningEnv(config)
  log.step(`构建（签名私钥：${key.source === 'env' ? key.keyPath : toRelative(config.projectRoot, key.keyPath)}）`)

  for (const platform of plan.platforms) {
    log.info(`→ ${platform.label}`)
    runCommand(buildCommandFor(config, platform), { cwd: config.projectRoot, env })
  }
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof resolvePlan>} plan
 */
function collectBuilds(config, plan) {
  return plan.platforms.map((platform) => ({
    platform,
    files: collectArtifacts(config.projectRoot, platform),
  }))
}

/**
 * 把各平台产物汇总到 releases/v{version}/。
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof resolvePlan>} plan
 * @param {ReturnType<typeof collectBuilds>} builds
 */
function stageArtifacts(config, plan, builds) {
  const artifactDir = resolveArtifactDir(config, plan.targetVersion)
  mkdirSync(artifactDir, { recursive: true })

  let copied = 0
  for (const build of builds) {
    if (build.files.length === 0) {
      log.warn(`${build.platform.label} 没有找到任何产物（跳过）`)
      continue
    }
    for (const file of build.files) {
      cpSync(file, join(artifactDir, basename(file)), { force: true })
      copied += 1
    }
  }

  if (copied === 0) {
    throw new ReleaseError('没有收集到任何构建产物', {
      hints: ['先构建，或去掉 --skip-build', '确认所选平台与实际构建的 target 一致'],
    })
  }

  log.ok(`已收集 ${copied} 个产物 → ${toRelative(config.projectRoot, artifactDir)}/`)
  return artifactDir
}

/**
 * 逐个 .sig 比对签名者与 tauri.conf.json 的 pubkey。
 * 签错 key 的包能上传、能被检测到，只有用户点安装才报错——必须在发出去之前拦住。
 *
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof collectBuilds>} builds
 */
function verifySignatures(config, builds) {
  const expected = readConfiguredPubkey(config.tauriConfigPath)
  const sigFiles = builds.flatMap((build) => build.files.filter((file) => file.endsWith('.sig')))

  if (sigFiles.length === 0) {
    throw new ReleaseError('产物里没有任何 .sig 签名文件', {
      hints: [
        'tauri.conf.json 的 bundle.createUpdaterArtifacts 必须为 true',
        '构建时必须注入 TAURI_SIGNING_PRIVATE_KEY（本 Skill 会自动注入，除非用了自定义构建脚本）',
      ],
    })
  }

  const { checked, mismatches } = verifySignatureKeys(sigFiles, expected.keynum)
  if (mismatches.length > 0) {
    throw new ReleaseError('构建产物的签名密钥与 tauri.conf.json 的 pubkey 不一致', {
      hints: [
        `期望 keynum ${expected.keynum}`,
        ...mismatches.map((item) => `${basename(item.file)} → ${item.keynum}`),
        '常见原因：残留的旧 bundle 目录、或构建走了没注入签名的自定义脚本',
        '先清掉 src-tauri/target/**/bundle 再重新构建',
      ],
    })
  }
  log.ok(`签名校验通过（${checked} 个 .sig，keynum ${expected.keynum}）`)
}

/**
 * **每个目标一份 manifest**，URL 指向自己。主目标那份同时写到 releases/latest.json 供提交。
 *
 * @param {object} params
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} params.config
 * @param {ReturnType<typeof resolvePlan>} params.plan
 * @param {ReturnType<typeof collectBuilds>} params.builds
 * @param {string} params.notes
 * @param {string} params.artifactDir
 */
function writeManifests({ config, plan, builds, notes, artifactDir }) {
  const { entries, skipped } = collectUpdaterEntries(builds)
  for (const platformId of skipped) {
    log.warn(`${platformId} 没有带 .sig 的 updater 包，不会出现在 latest.json 里`)
  }

  const targets = selectTargets(config, plan)
  const pubDate = new Date().toISOString()
  const manifestRoot = join(artifactDir, MANIFEST_DIR)
  rmSync(manifestRoot, { recursive: true, force: true })

  /** @type {Array<{ target: NonNullable<ReturnType<import('../lib/targets.mjs').getTarget>>, path: string }>} */
  const manifests = []

  for (const target of targets) {
    const manifest = buildManifest({ version: plan.targetVersion, notes, entries, target, pubDate })
    const dir = join(manifestRoot, target.name)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'latest.json')
    writeManifest(path, manifest)
    manifests.push({ target, path })

    for (const warning of auditManifest(manifest)) log.warn(warning)
    log.ok(`${target.label} manifest：${Object.keys(manifest.platforms).join(', ')}`)
  }

  // 仓库里留一份便于 review 与跨版本 diff；用哪个目标的 URL 规则由 primaryTarget 决定。
  if (manifests.length > 0) {
    const primary = pickPrimaryTarget(config, targets)
    const chosen = manifests.find((item) => item.target.name === primary.name) ?? manifests[0]
    const repoCopy = join(config.projectRoot, config.releaseDir, 'latest.json')
    mkdirSync(join(config.projectRoot, config.releaseDir), { recursive: true })
    cpSync(chosen.path, repoCopy, { force: true })
    log.detail(`releases/latest.json 使用 ${chosen.target.label} 版 URL`)
  }

  return manifests
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof resolvePlan>} plan
 */
function selectTargets(config, plan) {
  const all = listTargets(config)
  if (all.length === 0) throw new ReleaseError('release.config.json 未配置 github / gitcode')
  if (plan.onlyTargets.length === 0) return all

  const picked = all.filter((target) => plan.onlyTargets.includes(target.name))
  if (picked.length === 0) {
    throw new ReleaseError(`--target 未匹配到任何已配置目标：${plan.onlyTargets.join(', ')}`)
  }
  return picked
}

/**
 * @param {object} params
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} params.config
 * @param {ReturnType<typeof resolvePlan>} params.plan
 * @param {string} params.artifactDir
 * @param {ReturnType<typeof writeManifests>} params.manifests
 * @param {string} params.notes
 */
async function upload({ config, plan, artifactDir, manifests, notes }) {
  const assets = readdirSync(artifactDir)
    .map((name) => join(artifactDir, name))
    .filter((path) => statSync(path).isFile())
    .filter((path) => basename(path) !== 'latest.json')

  let uploaded = 0
  for (const { target, path } of manifests) {
    if (!target.token) {
      log.warn(`跳过 ${target.label}：未配置 token`)
      continue
    }
    await uploadToTarget({
      config,
      target,
      version: plan.targetVersion,
      notes,
      // manifest 必须最后传：它一出现在 Release 里，客户端就会开始按它下载。
      files: [...assets, path],
      replace: plan.replaceAssets,
    })
    uploaded += 1
  }

  if (uploaded === 0) {
    throw new ReleaseError('没有上传到任何平台', { hints: ['配置 GITHUB_TOKEN / GITCODE_TOKEN 后重试'] })
  }
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof resolvePlan>} plan
 */
function printPlan(config, plan) {
  log.step('dry-run：将执行以下步骤')
  log.detail(`版本：v${plan.currentVersion}${plan.targetVersion !== plan.currentVersion ? ` → v${plan.targetVersion}` : '（保持）'}`)
  log.detail(`平台：${plan.platforms.map((platform) => platform.label).join('、')}`)
  for (const platform of plan.platforms) {
    log.detail(`构建：${buildCommandFor(config, platform)}`)
  }
  log.detail(`产物：${config.releaseDir}/v${plan.targetVersion}/`)
  log.detail(`manifest：逐目标生成（${selectTargets(config, plan).map((target) => target.label).join('、')}）`)
  log.detail(`git：${plan.push ? `commit + tag v${plan.targetVersion} + push 全部远程` : '不动'}`)
  log.detail(`上传：${plan.upload ? '是' : '否'}`)
  log.detail(`线上自检：${plan.upload && !plan.skipVerify ? '是' : '否'}`)
}
