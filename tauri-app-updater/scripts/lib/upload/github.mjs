/**
 * GitHub Release 上传。资产上传走 uploads.github.com，与 API 域名不同。
 */
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'

import { log, ReleaseError } from '../log.mjs'
import { request, requestJson } from '../http.mjs'

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} method
 * @param {string} path
 * @param {BodyInit} [body]
 */
function api(target, method, path, body) {
  return requestJson(`${target.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${target.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  })
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {{ tag: string, name: string, body: string, branch: string }} release
 * @returns {Promise<{ id: number, uploadUrl: string }>}
 */
export async function ensureRelease(target, release) {
  const base = `/repos/${target.owner}/${target.repo}`
  const existing = await api(target, 'GET', `${base}/releases/tags/${encodeURIComponent(release.tag)}`)
  if (existing.ok && existing.json?.id) {
    log.info(`GitHub Release 已存在：${release.tag}`)
    return { id: existing.json.id, uploadUrl: existing.json.upload_url }
  }

  const created = await api(
    target,
    'POST',
    `${base}/releases`,
    JSON.stringify({
      tag_name: release.tag,
      name: release.name,
      body: release.body,
      target_commitish: release.branch || undefined,
      draft: false,
      prerelease: false,
    }),
  )

  if (!created.ok || !created.json?.id) {
    throw new ReleaseError(`创建 GitHub Release 失败（HTTP ${created.status}）`, {
      hints: [created.text.slice(0, 400), 'Token 需要 contents:write 权限'],
    })
  }
  log.ok(`GitHub Release 已创建：${release.tag}`)
  return { id: created.json.id, uploadUrl: created.json.upload_url }
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {number} releaseId
 */
export async function listAssets(target, releaseId) {
  const result = await api(
    target,
    'GET',
    `/repos/${target.owner}/${target.repo}/releases/${releaseId}/assets?per_page=100`,
  )
  if (!result.ok || !Array.isArray(result.json)) return null
  return result.json.map((item) => ({ id: item.id, name: item.name }))
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {{ id: number, name: string }} asset
 */
export async function deleteAsset(target, asset) {
  const result = await api(
    target,
    'DELETE',
    `/repos/${target.owner}/${target.repo}/releases/assets/${asset.id}`,
  )
  return result.ok
}

/**
 * @param {NonNullable<ReturnType<import('../targets.mjs').getTarget>>} target
 * @param {string} uploadUrlTemplate `https://uploads.github.com/...{?name,label}`
 * @param {string} filePath
 */
export async function uploadAsset(target, uploadUrlTemplate, filePath) {
  const fileName = basename(filePath)
  const endpoint = `${uploadUrlTemplate.replace(/\{\?[^}]*\}$/, '')}?name=${encodeURIComponent(fileName)}`

  const response = await request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(statSync(filePath).size),
    },
    body: readFileSync(filePath),
    timeoutMs: 600_000,
  })

  if (!response.ok) {
    const body = await response.text()
    if (response.status === 422 && /already_exists/i.test(body)) return { status: 'exists' }
    throw new ReleaseError(`上传失败：${fileName}（HTTP ${response.status}）`, {
      hints: [body.slice(0, 400)],
    })
  }
  return { status: 'uploaded' }
}
