/**
 * 带超时与重试的 fetch 包装。发版上传动辄几十 MB，默认 fetch 没有超时会挂死在 CI 里。
 */

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
export async function request(url, init = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 返回解析好的 JSON（解析失败时把原文放进 `.raw`），不抛异常。
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
export async function requestJson(url, init = {}) {
  const response = await request(url, init)
  const text = await response.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text }
    }
  }
  return { ok: response.ok, status: response.status, json, text }
}

/**
 * 只取响应头，用于校验下载地址是否真的可下。
 *
 * 有些对象存储对 HEAD 返回 405，所以退化成 Range 请求只取首字节。
 * @param {string} url
 */
export async function probe(url) {
  try {
    const head = await request(url, { method: 'HEAD', redirect: 'follow', timeoutMs: 30_000 })
    if (head.status !== 405 && head.status !== 501) {
      return { status: head.status, size: Number(head.headers.get('content-length')) || 0 }
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      return { status: 0, size: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  try {
    const ranged = await request(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      timeoutMs: 30_000,
    })
    await ranged.body?.cancel()
    return { status: ranged.status, size: Number(ranged.headers.get('content-range')?.split('/')[1]) || 0 }
  } catch (error) {
    return { status: 0, size: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
