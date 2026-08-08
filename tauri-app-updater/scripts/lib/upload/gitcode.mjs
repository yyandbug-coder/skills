/**
 * GitCode Release 上传。
 *
 * GitCode **不覆盖同名附件**：重发同一版本时旧文件会一直留着，而 latest.json 里的
 * URL 又指向那个名字 —— 客户端下到的是上一版的包。所以要么先删（`--replace`），
 * 要么明确告诉用户「跳过了哪些文件」，绝不能静默成功。
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import { log, ReleaseError } from '../log.mjs'
import { request, requestJson } from '../http.mjs'

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} method
 * @param {string} path
 * @param {BodyInit} [body]
 * @param {Record<string, string>} [headers]
 */
function api(target, method, path, body, headers = {}) {
  return requestJson(`${target.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${target.token}`, ...headers },
    body,
  })
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {{ tag: string, name: string, body: string, branch: string }} release
 */
export async function ensureRelease(target, release) {
  const base = `/repos/${target.owner}/${target.repo}`
  const existing = await api(target, 'GET', `${base}/releases/tags/${encodeURIComponent(release.tag)}`)
  if (existing.ok) {
    log.info(`GitCode Release 已存在：${release.tag}`)
    return
  }

  const created = await api(
    target,
    'POST',
    `${base}/releases`,
    JSON.stringify({
      tag_name: release.tag,
      name: release.name,
      body: release.body,
      target_commitish: release.branch,
    }),
    { 'Content-Type': 'application/json; charset=utf-8' },
  )

  if (!created.ok) {
    throw new ReleaseError(`创建 GitCode Release 失败（HTTP ${created.status}）`, {
      hints: [created.text.slice(0, 400), 'Token 权限不足 / tag 未推送 / owner-repo 配置有误'],
    })
  }
  log.ok(`GitCode Release 已创建：${release.tag}`)
}

/**
 * 列出已有附件。GitCode 的附件列表接口在部分实例上不可用，失败时返回 null 表示「未知」。
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} tag
 */
export async function listAssets(target, tag) {
  const result = await api(
    target,
    'GET',
    `/repos/${target.owner}/${target.repo}/releases/${encodeURIComponent(tag)}/attach_files`,
  )
  if (!result.ok || !Array.isArray(result.json)) return null
  return result.json.map((item) => ({ id: item.id, name: item.name || item.file_name || '' }))
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} tag
 * @param {{ id: string | number, name: string }} asset
 */
export async function deleteAsset(target, tag, asset) {
  const result = await api(
    target,
    'DELETE',
    `/repos/${target.owner}/${target.repo}/releases/${encodeURIComponent(tag)}/attach_files/${asset.id}`,
  )
  return result.ok
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} tag
 * @param {string} filePath
 */
export async function uploadAsset(target, tag, filePath) {
  const fileName = basename(filePath)
  const info = await api(
    target,
    'GET',
    `/repos/${target.owner}/${target.repo}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(fileName)}`,
  )

  if (!info.ok || !info.json?.url) {
    throw new ReleaseError(`获取 GitCode 上传地址失败：${fileName}`, {
      hints: [info.text.slice(0, 400)],
    })
  }

  const response = await request(info.json.url, {
    method: 'PUT',
    headers: info.json.headers ?? {},
    body: readFileSync(filePath),
    timeoutMs: 600_000,
  })

  if (!response.ok) {
    const body = await response.text()
    if (/already exists|已存在/i.test(body)) return { status: 'exists' }
    throw new ReleaseError(`上传失败：${fileName}（HTTP ${response.status}）`, {
      hints: [body.slice(0, 400)],
    })
  }
  return { status: 'uploaded' }
}
