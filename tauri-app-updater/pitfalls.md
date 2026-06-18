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
| `release.mjs --platform android` | 未找到 Android 产物 | 先执行 `pnpm tauri android build`；产物在 `src-tauri/gen/android/app/build/outputs/` |
| `tauri android build` | `cargo build ... --apk --aab` exited with code 1；cargo 提示 `unexpected argument '--apk'` | 旧版 `@tauri-apps/cli` 不识别 `--apk`/`--aab`，会当作 cargo 参数转发。**去掉这两个 flag**，用 `pnpm tauri android build` 即可（默认同时打 APK + AAB）；并改 `release.config.json` 的 `mobile.androidBuildCommand`。若仍失败，升级 CLI：`pnpm add -D @tauri-apps/cli@latest` |
| 同上 `--platform ios` | 未找到 IPA | 需 macOS + Xcode；产物在 `src-tauri/gen/apple/build/arm64/*.ipa` |
| 上传脚本 | `.apk` 未上传 | 旧版按版本号过滤文件名；现已对 `.apk`/`.aab`/`.ipa` 始终上传 |
| 仅移动端发版 | 无 `latest.json` | 正常；移动端不走 Tauri updater，包直接挂在 Release 附件 |
| Android 签名 | `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | 使用已签名 release APK，勿上传 `-unsigned.apk` |
| `useMobileUpdate` | 点击无反应 / 无法打开浏览器 | 检查 `opener:default` 权限与 `@tauri-apps/plugin-opener` |
| 同上 | 始终提示已是最新 | 确认 `release.config.json` 的 `mobile.update` 与 Release 中 latest.json / tag 一致 |
| 仅移动端发版 | `latest.json` 不存在导致检查失败 | 将 `mobile.update.versionSource` 改为 `release-api` |

## 发版脚本

| 现象 | 原因 | 处理 |
|------|------|------|
| `readPlatformArgs is not defined` | 项目内 `.cursor/skills/tauri-app-updater`（或 `.agents/skills/`）为**旧版 Skill**，`release.mjs` 调用了 `readPlatformArgs` 但未 import；`updater-skill.mjs` **优先使用项目内副本**，会挡住已更新的全局 Skill | 删除项目内旧目录后重装：`Remove-Item -Recurse -Force .cursor\skills\tauri-app-updater`，再 `npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y`；或手动把全局 `~/.agents/skills/tauri-app-updater/scripts/` 同步到项目内 |

## 版本号与 `--skip-bump`

| 现象 | 原因 | 处理 |
|------|------|------|
| 构建/上传失败后版本仍停留在新版本 | 旧版 Skill 先 bump 再构建，失败时不会回退 | 升级 Skill 后失败会自动写回 bump 前版本；已 push/upload 成功则不会回退；本次可 `pnpm release:cli --set-version 0.1.7 --skip-build` 或手改三处版本文件 |
| push 成功但 upload 失败 | 远程 tag 已含新版本 | 版本号不会自动回退（避免与远程不一致）；修复 upload 后重试 `--skip-bump --skip-build --upload` |
| push 失败但本地已有 commit/tag | git commit/tag 在 push 前已创建 | 回退版本文件后需手动 `git tag -d` / `git reset` 清理本地 tag 与 commit |
| 选了「保持当前版本」但 `package.json` 仍 patch +1 | `tauriBuildCommand` 配了 `pnpm tauri:deploy` 等一体脚本，Skill 跳过了自身 bump，但脚本末尾仍会 `bump-version.mjs` | 将 `tauriBuildCommand` 改为 `pnpm tauri build`；或确保 Skill 已透传 `--skip-bump`（v2025-06 起） |
| `Info.plist` 从旧版变为与 `tauri.conf.json` 一致 | **不是 bump**：`src-tauri/gen/apple/**/Info.plist` 为生成文件，构建时会从 `tauri.conf.json` 同步版本 | 若源文件已是目标版本，可忽略；勿单独手改 gen 目录 |
| `tauriBuildCommand` 用了项目 deploy 脚本 | deploy 默认构建+上传+bump 一条龙 | Skill 发版用 `desktop.defaultBuildCommand` / `mobile.*BuildCommand` 分平台构建 |


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
