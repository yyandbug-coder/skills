/**
 * 体检 / 验证结果的统一渲染与判定。
 */
import { dim, green, red, yellow } from './log.mjs'

const ICON = { ok: green('✓'), warn: yellow('!'), fail: red('✗') }

/**
 * @param {import('./doctor.mjs').CheckResult[]} results
 * @param {string} title
 */
export function printReport(results, title) {
  console.log(`\n${title}`)
  for (const result of results) {
    console.log(`  ${ICON[result.status]} ${result.name}  ${dim(result.message)}`)
    for (const hint of result.hints ?? []) {
      console.log(`      ${dim('→')} ${dim(hint)}`)
    }
  }

  const failed = results.filter((result) => result.status === 'fail').length
  const warned = results.filter((result) => result.status === 'warn').length
  const summary = [
    `${results.length - failed - warned} 通过`,
    warned > 0 ? yellow(`${warned} 警告`) : '',
    failed > 0 ? red(`${failed} 失败`) : '',
  ].filter(Boolean)
  console.log(`  ${dim('—')} ${summary.join(dim(' · '))}\n`)

  return { failed, warned }
}

/**
 * @param {import('./doctor.mjs').CheckResult[]} results
 */
export function hasFailure(results) {
  return results.some((result) => result.status === 'fail')
}
