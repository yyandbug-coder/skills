/**
 * `cli.mjs upload` —— 把 releases/v{version}/ 传到各发版平台。
 *
 * **上传顺序有讲究**：latest.json 必须最后传。它一出现在 Release 里，所有客户端就会
 * 立刻按它去下载安装包；先传 manifest 再传包，中间那段时间用户拿到的是 HTTP 500。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import * as gitcode from '../lib/upload/gitcode.mjs'
import * as github from '../lib/upload/github.mjs'
import { currentBranch } from '../lib/git.mjs'
import { log, ReleaseError, setLogScope } from '../lib/log.mjs'
import { interpolate } from '../lib/notes.mjs'
import { readJson, resolveArtifactDir, readProjectVersion, toRelative } from '../lib/project.mjs'
import { runCommand } from '../lib/shell.mjs'
import { expandCustomBase, listTargets, tagFor } from '../lib/targets.mjs'

const MANIFEST_DIR = '.manifests'

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 * @param {import('../lib/args.mjs').Args} context.args
 */
export async function uploadCommand({ config, args }) {
  setLogScope('upload')

  const version = (args.get('version') || readProjectVersion(config)).replace(/^v/, '')
  const artifactDir = resolveArtifactDir(config, version)
  if (!existsSync(artifactDir)) {
    throw new ReleaseError(`产物目录不存在：${toRelative(config.projectRoot, artifactDir)}`, {
      hints: [`先构建：cli.mjs release --set-version ${version}`],
    })
  }

  const manifestRoot = join(artifactDir, MANIFEST_DIR)
  if (!existsSync(manifestRoot)) {
    throw new ReleaseError('缺少各平台的 latest.json', {
      hints: [`生成：cli.mjs manifest --version ${version} --platform <平台>`],
    })
  }

  const assets = readdirSync(artifactDir)
    .map((name) => join(artifactDir, name))
    .filter((path) => statSync(path).isFile())
    .filter((path) => basename(path) !== 'latest.json')

  const onlyTargets = args.list('target')
  const targets = listTargets(config).filter(
    (target) => onlyTargets.length === 0 || onlyTargets.includes(target.name),
  )

  let uploaded = 0
  for (const target of targets) {
    const manifestPath = join(manifestRoot, target.name, 'latest.json')
    if (!existsSync(manifestPath)) {
      log.warn(`跳过 ${target.label}：没有为它生成 latest.json`)
      continue
    }
    if (!target.token) {
      log.warn(`跳过 ${target.label}：未配置 token`)
      continue
    }

    const notes = args.get('notes') || readJson(manifestPath).notes || `${config.appName} v${version}`
    await uploadToTarget({
      config,
      target,
      version,
      notes,
      files: [...assets, manifestPath],
      replace: args.has('replace'),
    })
    uploaded += 1
  }

  if (uploaded === 0) throw new ReleaseError('没有上传到任何平台')
  log.ok(`上传完成：v${version}（${uploaded} 个平台）`)
}

/**
 * @param {object} params
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} params.config
 * @param {NonNullable<ReturnType<import('../lib/targets.mjs').getTarget>>} params.target
 * @param {string} params.version
 * @param {string} params.notes
 * @param {string[]} params.files 最后一项必须是 latest.json
 * @param {boolean} params.replace
 */
export async function uploadToTarget({ config, target, version, notes, files, replace }) {
  const tag = tagFor(version)
  const branch = target.defaultBranch || currentBranch(config.projectRoot) || 'master'
  const release = { tag, name: `${config.appName} ${tag}`, body: notes, branch }

  log.step(`上传到 ${target.label}（${target.owner}/${target.repo} @ ${tag}）`)

  // 自建服务器是「整个目录一次性推上去」的语义，不是逐文件调 API。
  if (target.name === 'custom') {
    return uploadToCustomHost({ config, target, version, files })
  }

  const driver = target.name === 'github'
    ? await githubDriver(target, release, replace)
    : await gitcodeDriver(target, release, replace)

  let uploaded = 0
  let skipped = 0
  for (const file of files) {
    const result = await driver.upload(file)
    if (result.status === 'exists') {
      skipped += 1
      log.warn(`已存在，未覆盖：${basename(file)}`)
    } else {
      uploaded += 1
      log.detail(`已上传 ${basename(file)}`)
    }
  }

  if (skipped > 0) {
    log.warn(
      `${skipped} 个同名附件被跳过。重发同一版本请加 --replace，否则用户下到的仍是旧包。`,
    )
  }
  log.ok(`${target.label}：上传 ${uploaded} 个，跳过 ${skipped} 个`)
}

/**
 * 自建服务器：把产物集中到一个待上传目录，再执行项目提供的 `uploadCommand`。
 *
 * Skill 不猜你用 S3 还是 rsync——那是无底洞。它只保证三件事：
 * 目录里的文件名与 manifest 里的 URL 严格一致、latest.json 排在最后一个、
 * 命令失败就中止（不会让流水线继续走到「线上自检」去报一堆莫名其妙的 404）。
 *
 * @param {object} params
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} params.config
 * @param {NonNullable<ReturnType<import('../lib/targets.mjs').getTarget>>} params.target
 * @param {string} params.version
 * @param {string[]} params.files
 */
function uploadToCustomHost({ config, target, version, files }) {
  if (!target.uploadCommand) {
    throw new ReleaseError('自建服务器缺少 uploadCommand', {
      hints: [
        'release.config.json → custom.uploadCommand',
        '可用占位：{dir} 待上传目录、{version}、{tag}、{baseUrl}',
        '例：rsync -av --delete {dir}/ deploy@host:/var/www/releases/{tag}/',
        '例：aws s3 sync {dir}/ s3://my-bucket/releases/{tag}/ --delete',
      ],
    })
  }

  // 单独一个 staging 目录：产物目录里还有 .manifests/ 等中间物，不能整个推上去。
  const staging = join(resolveArtifactDir(config, version), '.upload')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const file of files) {
    cpSync(file, join(staging, basename(file)), { force: true })
  }

  const command = interpolate(target.uploadCommand, {
    dir: staging,
    version: String(version).replace(/^v/, ''),
    tag: tagFor(version),
    baseUrl: expandCustomBase(target, version),
  })

  log.detail(`${files.length} 个文件 → ${toRelative(config.projectRoot, staging)}/`)
  runCommand(command, { cwd: config.projectRoot })
  log.ok(`${target.label}：已执行 uploadCommand`)
}

/**
 * @param {NonNullable<ReturnType<import('../lib/targets.mjs').getTarget>>} target
 * @param {{ tag: string, name: string, body: string, branch: string }} release
 * @param {boolean} replace
 */
async function githubDriver(target, release, replace) {
  const created = await github.ensureRelease(target, release)
  const existing = replace ? await github.listAssets(target, created.id) : null

  return {
    /** @param {string} file */
    async upload(file) {
      if (existing) await removeExisting(existing, basename(file), (asset) => github.deleteAsset(target, asset))
      return github.uploadAsset(target, created.uploadUrl, file)
    },
  }
}

/**
 * @param {NonNullable<ReturnType<import('../lib/targets.mjs').getTarget>>} target
 * @param {{ tag: string, name: string, body: string, branch: string }} release
 * @param {boolean} replace
 */
async function gitcodeDriver(target, release, replace) {
  await gitcode.ensureRelease(target, release)
  const existing = replace ? await gitcode.listAssets(target, release.tag) : null
  if (replace && existing === null) {
    log.warn('GitCode 未返回附件列表，无法自动删除同名文件；请到 Release 页面手动删除后重试')
  }

  return {
    /** @param {string} file */
    async upload(file) {
      if (existing) {
        await removeExisting(existing, basename(file), (asset) => gitcode.deleteAsset(target, release.tag, asset))
      }
      return gitcode.uploadAsset(target, release.tag, file)
    },
  }
}

/**
 * @param {Array<{ id: string | number, name: string }>} existing
 * @param {string} fileName
 * @param {(asset: { id: string | number, name: string }) => Promise<boolean>} remove
 */
async function removeExisting(existing, fileName, remove) {
  const matches = existing.filter((asset) => asset.name === fileName)
  for (const asset of matches) {
    const ok = await remove(asset)
    if (ok) log.detail(`已删除同名旧附件 ${fileName}`)
    else log.warn(`删除旧附件失败：${fileName}`)
  }
}
