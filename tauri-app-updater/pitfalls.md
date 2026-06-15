# Tauri 自动更新 — 踩坑矩阵

## 远程上传失败

| 模块 | 典型症状 | 原因与处理 |
|------|----------|------------|
| Skill `gitcode-upload-release.mjs` | `缺少 GITCODE_TOKEN` | 设置 `$env:GITCODE_TOKEN` |
| 同上 | `已存在，跳过：xxx` | GitCode **不覆盖**同名附件；重发前手动删 Release 附件 |
| `release.config.json` | 404 / 上传到错误仓库 | 检查 `owner`/`repo`/`apiUrl` |
| Skill `release.mjs` + 签名 | 产物无 `.sig` | 私钥缺失；检查 `~/.tauri/<app>.key` 或环境变量 |
| Skill `generate-latest-json.mjs` | `未找到任何 .sig` | `createUpdaterArtifacts` 未开启或 build 失败 |
| `RELEASE_BASE_URL` / tag | latest.json URL 指向错误版本 | tag 须为 `v{version}`，与 `--set-version` 一致 |
| `release.mjs --push` | `tag 已存在` | 重发同版本只用 `--upload`，不要 `--push` |
| GitCode API | 获取上传 URL 失败 | Token 权限不足、Release 未创建、网络/代理 |

## 远程下载失败

| 模块 | 典型症状 | 原因与处理 |
|------|----------|------------|
| `tauri.conf.json` `plugins.updater.endpoints` | 检查更新失败 | endpoint 须为 `.../latest/attach_files/latest.json/download` |
| `releases/latest.json` `platforms.*.url` | `error sending request for url` | URL 须为 `attach_files/{encodeURIComponent(文件名)}/download`；GitCode 302 到 CDN |
| `Cargo.toml` `tauri-plugin-updater` | 下载 0B 后失败 | 默认 `rustls-tls` 在部分 Windows 不稳定；改用 `native-tls` |
| `app_updater.rs` | 同上 | 须 `configure_client` 超时 + fallback 到应用内 `reqwest` |
| `app-updater.ts` | 开发模式无法更新 | `import.meta.env.DEV` 下禁用；用正式安装包测试 |
| `tauri.conf.json` `pubkey` | 下载后安装/校验失败 | pubkey 与构建签名私钥不匹配 |
| `capabilities/default.json` | 权限错误 | 缺少 `updater:default`、`process:allow-restart` |
| 安装包文件名含空格 | 偶发 URL 问题 | `generate-latest-json` 须 `encodeURIComponent(fileName)` |
| 客户端版本过旧 | 修复后仍下载失败 | 下载修复在**新安装包**内；旧用户须手动装一次 |

## 移动端上传

| 模块 | 典型症状 | 原因与处理 |
|------|----------|------------|
| `release.mjs --platform android` | 未找到 Android 产物 | 先执行 `pnpm tauri android build -- --apk --aab`；产物在 `src-tauri/gen/android/app/build/outputs/` |
| 同上 `--platform ios` | 未找到 IPA | 需 macOS + Xcode；产物在 `src-tauri/gen/apple/build/arm64/*.ipa` |
| 上传脚本 | `.apk` 未上传 | 旧版按版本号过滤文件名；现已对 `.apk`/`.aab`/`.ipa` 始终上传 |
| 仅移动端发版 | 无 `latest.json` | 正常；移动端不走 Tauri updater，包直接挂在 Release 附件 |
| Android 签名 | `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | 使用已签名 release APK，勿上传 `-unsigned.apk` |
| `useMobileUpdate` | 点击无反应 / 无法打开浏览器 | 检查 `opener:default` 权限与 `@tauri-apps/plugin-opener` |
| 同上 | 始终提示已是最新 | 确认 `release.config.json` 的 `mobile.update` 与 Release 中 latest.json / tag 一致 |
| 仅移动端发版 | `latest.json` 不存在导致检查失败 | 将 `mobile.update.versionSource` 改为 `release-api` |

## 发版后验证

```bash
# 1. latest.json
curl -sL "<endpoints 中的 latest.json URL>"

# 2. 安装包可下载（应返回 200）
curl -sL -o NUL -w "%{http_code}" "<latest.json 中 platforms.url>"
```

## 重发同版本流程

1. GitCode Release 页删除旧 `.exe`、`.sig`、`latest.json`
2. `pnpm create:release` → 打包并上传 → **保持当前版本** 或 **指定版本号**
3. 执行发版后验证
