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
| GitCode `attach_files` | 检查更新成功，下载报 **HTTP 500** | `latest.json` 里的安装包**未上传到 Release**（GitCode 对缺失附件常返回 500 而非 404）。核对 Release 附件是否含 `*.app.tar.gz` / `.exe` 等，与 `platforms.*.url` 文件名一致 |
| `upload-release.mjs` | `latest.json` 指向 tar.gz，下载 500 | **仅上传**时脚本会从 bundle 目录**重新生成** `latest.json`，但只上传 `releases/v{version}/` 里已有文件；若目录缺 `.app.tar.gz` 仍会生成错误 manifest。上传前确认产物目录完整，或先「仅打包」再上传 |

## 发版注意事项（Checklist）

发版前 / 上传前按下面核对，可避免「能检测到新版本、下载失败」或「桌面 updater 包漏传」。

### 1. 交互式向导：平台怎么选

| 场景 | 推荐勾选 | 避免 |
|------|----------|------|
| 本机 `pnpm tauri build` + iOS | **`desktop` + `ios`** | 只选 **`macos` + `ios`** |
| 本机默认构建 + Android | **`desktop` + `android`** | 只选 **`macos`**（产物路径不对） |
| 仅 Windows 桌面 | **`desktop`** 或 **`windows`** | — |
| 交叉编译 macOS（`aarch64-apple-darwin`） | **`macos`** | 与默认 `target/release/bundle` 混用 |

**原因**：勾选 **`macos`** 时，Skill 只从 `src-tauri/target/aarch64-apple-darwin/release/bundle/` 收集产物；本机默认 `pnpm tauri build` 产物在 `target/release/bundle/`。只选 `macos` 会**收集不到** `.app.tar.gz` / `.dmg`，但单独跑 `generate-latest-json` 仍可能从 bundle 生成含 tar.gz 的 `latest.json` → 上传后客户端下载 **HTTP 500**。

### 2. macOS：两种包，用途不同

| 文件 | 用途 | 是否必须上传 |
|------|------|----------------|
| `{AppName}.app.tar.gz` (+ `.sig`) | **应用内自动更新**（Tauri updater） | ✅ 必须 |
| `{AppName}_{version}_aarch64.dmg` | Release 页**手动下载**安装 | 建议上传，非 updater 必需 |

发版后检查 `releases/v{version}/` 目录**必须含** `.app.tar.gz`，不能只有 `.dmg`。

### 3. 上传前：产物目录清单

桌面 + 移动端典型目录 `releases/v{version}/`：

```
latest.json
{AppName}.app.tar.gz          # macOS updater（必传）
{AppName}.app.tar.gz.sig
{AppName}_{version}_aarch64.dmg
{AppName}_{version}_x64-setup.exe
{AppName}_{version}_x64-setup.exe.sig
{AppName}_{version}_android-universal.apk
{AppName}_{version}_android-universal.aab
{AppName}_{version}_ios.ipa
```

仅桌面 Windows：`latest.json` + `.exe` / `.msi` + 对应 `.sig`。

### 4. 上传前：远程可下载自检

```bash
# 1. 读 manifest
curl -sL "<tauri.conf.json endpoints 中的 latest.json URL>"

# 2. 逐个测 platforms.*.url（应 200 或 302，勿 500/404）
curl -sL -o /dev/null -w "%{http_code}\n" "<latest.json 里 darwin-aarch64.url>"
```

Windows PowerShell：

```powershell
curl.exe -sL -o NUL -w "%{http_code}" "<url>"
```

### 5. 「仅上传已有产物」流程

1. 先 **「仅打包」**（或本地构建 + 确认 `releases/v{version}/` 完整）
2. 再 **「仅上传」**；不要在上传目录缺 tar.gz 时单独跑 `pnpm release:upload`（会重写 `latest.json` 却漏传包）
3. GitCode **不覆盖**同名附件；重发同版本前先删 Release 里旧附件

### 6. Android 构建命令

```bash
# ✅ CLI 2.11+
pnpm tauri android build --target aarch64 --apk --aab

# ❌ --apk/--aab 在 -- 之后 → cargo 报 unexpected argument '--apk'
pnpm tauri android build --target aarch64 -- --apk --aab
```

`release.config.json` → `mobile.androidBuildCommand` 须与上一致。

### 7. 多机分平台发版

| 机器 | 平台参数示例 |
|------|----------------|
| Windows | `--platform windows` 或 `desktop` |
| macOS | `--platform desktop,ios`（本机默认 build） |
| CI | 按 job 分平台构建，合并 artifacts 后再 `generate-latest-json` + upload |

各平台产物合并到同一 `releases/v{version}/` 后再上传，避免 `latest.json` 只含部分平台。

## 移动端上传

| 模块 | 典型症状 | 原因与处理 |
|------|----------|------------|
| `release.mjs --platform android` | 未找到 Android 产物 | 先执行 `pnpm tauri android build --target aarch64 --apk --aab`；产物在 `src-tauri/gen/android/app/build/outputs/` |
| `tauri android build` | `cargo build ... --apk --aab` exited with code 1；cargo 提示 `unexpected argument '--apk'` | **`--apk`/`--aab` 写在 `--` 之后**会被转发给 cargo（错误：`tauri android build -- --apk --aab`）。CLI 2.11+ 须作为 **Tauri 子命令参数**写在 `--` 之前：`pnpm tauri android build --target aarch64 --apk --aab`；并改 `release.config.json` 的 `mobile.androidBuildCommand` |
| `compileUniversalReleaseKotlin` | `ScreenshotTileService.kt`：`ComponentName` / `boolean` 类型不匹配 | `TileService.requestListeningState` 签名为 `(Context, ComponentName)`，勿传 `(ComponentName, true)`；见 `android-patches/kotlin/ScreenshotTileService.kt` |
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

1. GitCode Release 页删除旧 `.exe`、`.sig`、**`.app.tar.gz`**、`latest.json` 等同名附件
2. 确认 `releases/v{version}/` 含 updater 包（macOS 须 `.app.tar.gz`，Windows 须 `.exe`/`.msi` + `.sig`）
3. `pnpm create:release` → **保持当前版本** 或 **指定版本号** → 打包并上传
4. 用 [发版注意事项](#发版注意事项checklist) 中的 curl 命令验证 `latest.json` 与各 `platforms.*.url`

## Windows 发版脚本

| 模块 | 典型症状 | 原因与处理 |
|------|----------|------------|
| `scripts/updater-skill.mjs` | `SyntaxError: Invalid or unexpected token`（行内中文乱码如 `脚本�?)`） | 旧版模板含 UTF-8 中文，在 Windows 上若被存成 GBK/UTF-16，Node 解析 `.mjs` 会失败。**处理**：更新 Skill 后在项目根目录重新执行 `init-project.mjs`，覆盖 `scripts/updater-skill.mjs`；新版模板为 **ASCII-only** |
| Git 换行/编码 | 脚本偶发解析异常 | Skill 仓库已添加 `.gitattributes`（`*.mjs text eol=lf`）；`git pull` 后确认文件为 UTF-8 + LF |
| 项目内旧 Skill 副本 | `readPlatformArgs is not defined`、平台选项缺失、macOS 产物路径错误 | `updater-skill.mjs` **优先**使用项目内 `skills/`、`.cursor/skills/` 副本，会挡住已更新的全局 Skill。**处理**：删除或同步项目内旧目录，与全局 Skill 或上游仓库对齐 |
| PowerShell 环境变量 | `缺少 GITCODE_TOKEN` 但已设置 | 使用 `$env:GITCODE_TOKEN="xxx"`（不要用 bash 的 `export`）；当前会话设置后再 `pnpm release` |
| `@clack/prompts` 交互 | 向导乱码、无法选择、立即退出 | 需在 **Windows Terminal** 或 **PowerShell 7+** 等 Unicode TTY 中运行；CI / 非交互管道不支持，请用 `pnpm release:cli` |
| `pnpm` / `git` 找不到 | `spawnSync pnpm ENOENT` | 安装 Node 后执行 `corepack enable`；确保 Git for Windows 在 PATH；在项目根目录打开终端 |
| 签名私钥路径 `~/.tauri/*.key` | 构建无 `.sig` | Windows 上 `~` 会展开为 `%USERPROFILE%`；确认 `%USERPROFILE%\.tauri\xxx.key` 存在，或设置 `release.config.json` 的 `signing.envKeyVar` |
| 本机 build 只选 `macos` | 有 `latest.json` 但 macOS 客户端下载 500 | 见上文 [发版注意事项](#发版注意事项checklist)；Windows 本机构建应选 **`desktop`** 或 **`windows`** |
