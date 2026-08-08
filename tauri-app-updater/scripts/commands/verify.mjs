/**
 * `cli.mjs verify` —— 发布后线上自检：manifest 版本对不对、每个安装包是不是真的能下。
 *
 * 这一步专治「客户端提示有新版本、点下载报错」：GitCode 对缺失附件返回 HTTP 500，
 * manifest 本身却完全正常，光看 latest.json 是查不出来的。
 */
import { ReleaseError, log, setLogScope } from '../lib/log.mjs'
import { readProjectVersion } from '../lib/project.mjs'
import { printReport } from '../lib/report.mjs'
import { verifyPublishedRelease } from '../lib/doctor.mjs'

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 * @param {import('../lib/args.mjs').Args} context.args
 */
export async function verifyCommand({ config, args }) {
  setLogScope('verify')

  const version = (args.get('version') || readProjectVersion(config)).replace(/^v/, '')
  const results = await verifyPublishedRelease({ config, version })
  const { failed } = printReport(results, `${config.appName} v${version} 发布验证`)

  if (failed > 0) {
    throw new ReleaseError(`${failed} 项未通过`, {
      hints: [
        '缺附件：到 Release 页面核对文件名与 latest.json 里的一致',
        '补传后重跑：cli.mjs upload --version ' + version + ' --replace',
      ],
    })
  }
  log.ok('线上更新链路正常')
}
