/**
 * `cli.mjs manifest` —— 只生成各平台的 latest.json，不构建不上传。
 * CI 里各 job 分平台构建、产物汇总后单独跑这一步。
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { auditManifest, buildManifest, collectUpdaterEntries, writeManifest } from '../lib/manifest.mjs'
import { collectArtifacts, resolvePlatforms } from '../lib/platforms.mjs'
import { log, ReleaseError, setLogScope } from '../lib/log.mjs'
import { readProjectVersion, resolveArtifactDir, toRelative } from '../lib/project.mjs'
import { resolveNotesFromProject } from '../lib/notes.mjs'
import { listTargets, NO_TARGET_HINTS, NO_TARGET_MESSAGE, pickPrimaryTarget } from '../lib/targets.mjs'

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 * @param {import('../lib/args.mjs').Args} context.args
 */
export function manifestCommand({ config, args }) {
  setLogScope('manifest')

  const version = (args.get('version') || readProjectVersion(config)).replace(/^v/, '')
  const platforms = resolvePlatforms(args.list('platform'))
  const notes = args.get('notes') || resolveNotesFromProject(config, version) || `${config.appName} v${version}`

  const builds = platforms.map((platform) => ({
    platform,
    files: collectArtifacts(config.projectRoot, platform),
  }))

  const { entries, skipped } = collectUpdaterEntries(builds)
  for (const platformId of skipped) log.warn(`${platformId} 没有带 .sig 的 updater 包`)

  const targets = listTargets(config)
  if (targets.length === 0) throw new ReleaseError(NO_TARGET_MESSAGE, { hints: NO_TARGET_HINTS })

  const artifactDir = resolveArtifactDir(config, version)
  const manifestRoot = join(artifactDir, '.manifests')
  rmSync(manifestRoot, { recursive: true, force: true })

  const pubDate = new Date().toISOString()
  const primary = pickPrimaryTarget(config, targets)
  /** @type {Map<string, string>} */
  const written = new Map()

  for (const target of targets) {
    const manifest = buildManifest({ version, notes, entries, target, pubDate })
    const dir = join(manifestRoot, target.name)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'latest.json')
    writeManifest(path, manifest)
    written.set(target.name, path)

    for (const warning of auditManifest(manifest)) log.warn(warning)
    log.ok(`${target.label}：${Object.keys(manifest.platforms).join(', ')}`)
  }

  const repoCopy = join(config.projectRoot, config.releaseDir, 'latest.json')
  mkdirSync(join(config.projectRoot, config.releaseDir), { recursive: true })
  cpSync(/** @type {string} */ (written.get(primary.name)), repoCopy, { force: true })
  log.ok(`已写入 ${toRelative(config.projectRoot, repoCopy)}（${primary.label} 版）与 ${targets.length} 份平台专属 manifest`)
}
