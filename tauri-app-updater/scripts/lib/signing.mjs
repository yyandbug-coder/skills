/**
 * 更新包签名：私钥定位、构建环境注入、minisign 公钥比对。
 *
 * 签名是整条更新链路里最容易「静默出错」的一环——用错私钥构建出来的包一样能上传、
 * 一样能被检测到，只有终端用户点了「安装」才会看到
 * `The signature was created with a different key`，而那时包已经发出去了。
 *
 * 因此这里做两件老实现没做的事：
 *   1. 私钥解析失败就**报错**，绝不 fallback 到一个不存在的 `~/.tauri/app.key`
 *      再把这个坏路径塞进构建子进程（旧版就是这样静默产出无 .sig 的包）。
 *   2. 构建后逐个比对 `.sig` 里的 keynum 与 tauri.conf.json 的 pubkey。
 */
import { existsSync, readFileSync } from 'node:fs'

import { ReleaseError } from './log.mjs'
import { tauriCommand } from './package-manager.mjs'
import { readJson, resolveProjectPath, toRelative } from './project.mjs'

/** Tauri CLI 会读的签名变量；注入前先全部清掉，避免误读 shell 里的陈年配置。 */
const SIGNING_ENV_KEYS = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PATH',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
]

/**
 * 私钥来源优先级：环境变量（CI） → release.config.json 的 privateKeyPath → 默认 .secrets/。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {{ source: 'env' | 'file', keyPath: string, content: string }}
 */
export function resolveSigningKey(config) {
  const envVar = config.signing.envKeyVar || 'TAURI_SIGNING_PRIVATE_KEY'
  const fromEnv = process.env[envVar]

  // CI 里习惯把私钥正文（而不是路径）放进环境变量。
  if (fromEnv && fromEnv.includes('untrusted comment')) {
    return { source: 'env', keyPath: `$${envVar}`, content: fromEnv.trim() }
  }

  const configured = config.signing.privateKeyPath || '.secrets/app.key'
  const keyPath = fromEnv && !fromEnv.includes('untrusted comment')
    ? resolveProjectPath(config.projectRoot, fromEnv)
    : resolveProjectPath(config.projectRoot, configured)

  if (!existsSync(keyPath)) {
    const relativeKey = toRelative(config.projectRoot, keyPath)
    throw new ReleaseError(`未找到更新签名私钥：${relativeKey}`, {
      hints: [
        `生成一对新密钥：${tauriCommand(config.packageManager, ['signer', 'generate', '-w', relativeKey, '--force', '--ci'])}`,
        '然后同步公钥与 updater 配置：doctor --fix',
        `或在 ${toRelative(config.projectRoot, config.configPath)} 里把 signing.privateKeyPath 指向已有私钥`,
      ],
    })
  }

  return { source: 'file', keyPath, content: readFileSync(keyPath, 'utf8').trim() }
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 */
export function resolveSigningPassword(config) {
  const passwordVar = config.signing.envPasswordVar || 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
  return process.env[passwordVar] ?? config.signing.privateKeyPassword ?? ''
}

/**
 * 构建子进程的环境：先剥掉继承来的签名变量，再写入本项目的。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
export function createSigningEnv(config, extraEnv = {}) {
  const key = resolveSigningKey(config)
  const env = { ...process.env, ...extraEnv }
  for (const name of SIGNING_ENV_KEYS) delete env[name]

  // 传正文而非路径：Windows 上路径里的空格与反斜杠是反复踩坑的来源。
  env.TAURI_SIGNING_PRIVATE_KEY = key.content
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = resolveSigningPassword(config)
  return { env, key }
}

/**
 * minisign 文件（公钥 / .sig）的第二行才是 base64 密钥体，第一行是注释。
 * @param {string} base64Content
 */
export function readMinisignKeyLine(base64Content) {
  const decoded = Buffer.from(String(base64Content).trim(), 'base64').toString('utf8')
  const keyLine = decoded.trim().split('\n')[1]?.trim()
  if (!keyLine) throw new ReleaseError('无效的 minisign 内容：缺少密钥行')
  return keyLine
}

/**
 * Ed25519 blob 结构：2 字节算法前缀 + 8 字节 keynum。公钥与签名的 keynum 一致即同一密钥。
 * @param {string} base64Content
 */
export function readMinisignKeynum(base64Content) {
  const bytes = Buffer.from(readMinisignKeyLine(base64Content), 'base64')
  if (bytes.length < 10) throw new ReleaseError('无效的 minisign 密钥行')
  return bytes.subarray(2, 10).toString('hex').toUpperCase()
}

/**
 * @param {string} tauriConfigPath
 */
export function readConfiguredPubkey(tauriConfigPath) {
  const pubkey = readJson(tauriConfigPath)?.plugins?.updater?.pubkey
  if (!pubkey) {
    throw new ReleaseError('tauri.conf.json 未配置 plugins.updater.pubkey', {
      hints: ['运行 <skill>/scripts/cli.mjs doctor --fix-pubkey 从私钥的 .pub 同步'],
    })
  }
  return { raw: String(pubkey), keynum: readMinisignKeynum(pubkey) }
}

/**
 * 私钥旁边的 `.pub`；没有就返回 null（CI 用环境变量注入正文时属正常）。
 * @param {string} keyPath
 */
export function readSiblingPubkey(keyPath) {
  const pubPath = `${keyPath}.pub`
  if (!existsSync(pubPath)) return null
  const raw = readFileSync(pubPath, 'utf8').trim()
  return { path: pubPath, raw, keynum: readMinisignKeynum(raw) }
}

/**
 * 逐个 `.sig` 比对签名者 keynum 是否等于 tauri.conf.json 的 pubkey。
 *
 * @param {string[]} sigFiles
 * @param {string} expectedKeynum
 * @returns {{ checked: number, mismatches: Array<{ file: string, keynum: string }> }}
 */
export function verifySignatureKeys(sigFiles, expectedKeynum) {
  /** @type {Array<{ file: string, keynum: string }>} */
  const mismatches = []
  for (const file of sigFiles) {
    const keynum = readMinisignKeynum(readFileSync(file, 'utf8'))
    if (keynum !== expectedKeynum) mismatches.push({ file, keynum })
  }
  return { checked: sigFiles.length, mismatches }
}
