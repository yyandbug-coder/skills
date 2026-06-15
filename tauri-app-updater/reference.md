# Tauri 自动更新 — 模块参考

## 目录结构

### Skill（全局，所有项目共用）

```
~/.agents/skills/tauri-app-updater/   # npx skills add 安装位置（Cursor）
├── SKILL.md
├── pitfalls.md
├── reference.md
├── templates/
│   ├── release.config.json
│   ├── capabilities/mobile-update.json
│   └── src/
│       ├── lib/mobile-update.ts
│       └── hooks/useMobileUpdate.ts
└── scripts/
    ├── init-project.mjs
    ├── release-interactive.mjs
    ├── release.mjs
    ├── generate-latest-json.mjs
    ├── generate-mobile-update-config.mjs
    ├── github-upload-release.mjs
    ├── gitcode-upload-release.mjs
    ├── upload-release.mjs
    ├── git-push-all.mjs
    └── lib/
        ├── skill-paths.mjs
        ├── load-release-config.mjs
    ├── release-targets.mjs
    ├── release-platforms.mjs
    ├── release-artifacts.mjs
        └── import-from-project.mjs
```

### 项目（每个 Tauri 应用）

```
project/
├── release.config.json
├── releases/
│   ├── latest.json
│   └── artifacts/
├── scripts/
│   └── updater-skill.mjs    # 由 init-project.mjs 生成，转发到 Skill
├── docs/RELEASE.md          # 可选，项目发版说明
├── src-tauri/
│   ├── tauri.conf.json
│   ├── Cargo.toml
│   ├── capabilities/default.json
│   └── src/app_updater.rs
└── src/
    ├── lib/
    │   ├── app-updater.ts
    │   ├── mobile-update.ts
    │   └── mobile-update-config.generated.ts
    └── hooks/
        ├── useAppUpdater.ts
        └── useMobileUpdate.ts
```

## 接入命令

```bash
# 1. 安装 Skill（每台电脑一次）
npx skills add yyandbug-coder/kitty-tools --skill tauri-app-updater -g -y

# 2. 接入项目（每个项目一次）
node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs
pnpm install
```

仓库：[github.com/yyandbug-coder/kitty-tools](https://github.com/yyandbug-coder/kitty-tools)（`owner/repo` 简写默认解析为 GitHub）

## release.config.json 字段

```json
{
  "appName": "Your App",
  "versionBump": "pre",
  "tauriBuildCommand": "pnpm tauri build",
  "desktop": {
    "windowsBuildCommand": "pnpm tauri build -- --target x86_64-pc-windows-msvc",
    "macosBuildCommand": "pnpm tauri build -- --target aarch64-apple-darwin",
    "linuxBuildCommand": "pnpm tauri build -- --target x86_64-unknown-linux-gnu"
  },
  "signing": {
    "privateKeyPath": "~/.tauri/<app-name>.key",
    "privateKeyPassword": "",
    "envKeyVar": "YOUR_APP_SIGNING_PRIVATE_KEY",
    "envPasswordVar": "YOUR_APP_SIGNING_PRIVATE_KEY_PASSWORD"
  },
  "github": {
    "owner": "<github-owner>",
    "repo": "<repo>",
    "defaultBranch": "master"
  },
  "gitcode": {
    "owner": "<owner>",
    "repo": "<repo>",
    "apiUrl": "https://api.gitcode.com/api/v5",
    "defaultBranch": "master"
  },
  "mobile": {
    "androidBuildCommand": "pnpm tauri android build -- --apk --aab",
    "iosBuildCommand": "pnpm tauri ios build",
    "artifactDirs": [],
    "update": {
      "target": "gitcode",
      "versionSource": "latest-json",
      "releasePageUrl": "",
      "versionCheckUrl": "",
      "releaseApiUrl": ""
    }
  }
}
```

`envKeyVar` / `envPasswordVar` 可选；未设置时默认使用 `TAURI_SIGNING_PRIVATE_KEY`。

### 桌面分平台构建（`desktop`）

| 字段 | 说明 |
|------|------|
| `windowsBuildCommand` | `--platform windows` 时执行 |
| `macosBuildCommand` | `--platform macos` 时执行 |
| `linuxBuildCommand` | `--platform linux` 时执行 |

`--platform desktop` 仍使用顶层 `tauriBuildCommand`（当前主机默认构建）。

### 移动端字段（`mobile`）

| 字段 | 说明 |
|------|------|
| `androidBuildCommand` | Android 构建命令，默认 `pnpm tauri android build -- --apk --aab` |
| `iosBuildCommand` | iOS 构建命令，默认 `pnpm tauri ios build` |
| `artifactDirs` | 额外搜索 `.apk` / `.aab` / `.ipa` 的目录（相对项目根或绝对路径） |

移动端产物默认从以下路径收集：

- Android：`src-tauri/gen/android/app/build/outputs/`（release 构建，优先 universal、已签名 APK）
- iOS：`src-tauri/gen/apple/build/`（`.ipa`）

复制到 `releases/artifacts/` 时会自动重命名为 `{AppName}_{version}_android-universal.apk` 等，便于 Release 页面识别与上传过滤。

`--platform` 支持**多选**（逗号分隔或重复传参）：

| 平台 | 说明 |
|------|------|
| `desktop` | 桌面默认构建（`tauriBuildCommand`，当前主机） |
| `windows` | Windows x86_64 |
| `macos` | macOS aarch64 |
| `linux` | Linux x86_64 |
| `android` | Android APK + AAB |
| `ios` | iOS IPA |
| `mobile` | 简写：`android` + `ios` |
| `all` | 简写：`desktop` + `android` + `ios` |

```bash
# 仅 Windows + Android
pnpm release:cli --platform windows,android --skip-bump --upload

# 多参数写法
pnpm release:cli --platform desktop --platform ios --part patch

# 全部
pnpm release:cli --platform all --upload
```

可在 `release.config.json` → `desktop` 中自定义各平台构建命令。

仅移动端发版时**不生成** `latest.json`（Tauri updater 仅用于桌面端）。

#### 移动端更新（跳转 Release 页）

| 字段 | 说明 |
|------|------|
| `update.target` | 检查版本与跳转的目标平台：`gitcode` / `github`，默认取已配置的主平台 |
| `update.versionSource` | `latest-json`（默认，读 Release 中的 latest.json）或 `release-api`（读 latest Release 的 tag_name） |
| `update.releasePageUrl` | 自定义 Release 列表页 URL，留空则按 owner/repo 自动生成 |
| `update.versionCheckUrl` | 自定义 latest.json 地址，留空则自动生成 |
| `update.releaseApiUrl` | 自定义 Release API 地址，留空则自动生成 |

生成前端配置：

```bash
pnpm release:mobile-config
# 输出 src/lib/mobile-update-config.generated.ts
```

Release 页 URL 示例：

- GitCode 列表：`https://gitcode.com/{owner}/{repo}/releases`
- GitCode 指定版本：`https://gitcode.com/{owner}/{repo}/releases/tag/v{version}`
- GitHub 最新：`https://github.com/{owner}/{repo}/releases/latest`
- GitHub 指定版本：`https://github.com/{owner}/{repo}/releases/tag/v{version}`

## 移动端更新（前端）

`init-project.mjs` 会写入：

```
src/lib/mobile-update.ts
src/lib/mobile-update-config.generated.ts   # pnpm release:mobile-config 生成
src/hooks/useMobileUpdate.ts
```

### 权限

在 `src-tauri/capabilities/` 中加入 `opener:default`（参考 `templates/capabilities/mobile-update.json`），并安装：

```bash
pnpm add @tauri-apps/plugin-opener
```

Rust 侧注册（`lib.rs`）：

```rust
#[cfg(mobile)]
app.handle().plugin(tauri_plugin_opener::init())?;
```

### Hook 用法

```tsx
import { useMobileUpdate } from '@/hooks/useMobileUpdate'

function AboutMobileUpdate() {
  const { phase, latestVersion, hasUpdate, checkAndOpenRelease, openReleasePage } = useMobileUpdate()

  return (
    <button onClick={() => checkAndOpenRelease()}>
      {phase === 'checking' ? '检查中…' : hasUpdate ? `前往下载 v${latestVersion}` : '检查更新'}
    </button>
  )
}
```

桌面 / 移动分流示例：

```tsx
import { platform } from '@tauri-apps/plugin-os'

const isMobile = platform() === 'android' || platform() === 'ios'

// isMobile ? useMobileUpdate() : useAppUpdater()
```

## latest.json URL 格式

每个平台 Release 中的 `latest.json` 应使用**该平台自身**的下载地址：

- **GitCode Endpoint**（检查更新）：
  `https://api.gitcode.com/api/v5/repos/{owner}/{repo}/releases/latest/attach_files/latest.json/download`
- **GitCode 安装包 URL**：
  `https://api.gitcode.com/api/v5/repos/{owner}/{repo}/releases/v{version}/attach_files/{encodeURIComponent(fileName)}/download`
- **GitHub Endpoint**：
  `https://github.com/{owner}/{repo}/releases/latest/download/latest.json`
- **GitHub 安装包 URL**：
  `https://github.com/{owner}/{repo}/releases/download/v{version}/{fileName}`

`tauri.conf.json` 可配置多个 `endpoints`，应用会依次尝试。

## Rust 命令注册

```rust
// lib.rs
.manage(app_updater::PendingAppUpdate(Mutex::new(None)))
.invoke_handler(tauri::generate_handler![
    app_updater::check_app_update_cmd,
    app_updater::download_install_app_update_cmd,
])
```

## 前端 Hook 模式

- `useAppUpdater`：phase、checkForUpdate、installUpdate
- `useStartupUpdateCheck`：启动静默检查 + toast
- `app-updater-pending.ts`：跨窗口共享 pending 更新信息

## package.json scripts

由 `init-project.mjs` 自动合并，等价于：

```json
{
  "release": "node scripts/updater-skill.mjs release-interactive.mjs",
  "create:release": "node scripts/updater-skill.mjs release-interactive.mjs",
  "release:cli": "node scripts/updater-skill.mjs release.mjs",
  "release:publish": "node scripts/updater-skill.mjs release.mjs --publish",
  "release:upload": "node scripts/updater-skill.mjs upload-release.mjs",
  "release:upload:github": "node scripts/updater-skill.mjs github-upload-release.mjs",
  "release:upload:gitcode": "node scripts/updater-skill.mjs gitcode-upload-release.mjs",
  "git:push-all": "node scripts/updater-skill.mjs git-push-all.mjs",
  "release:json": "node scripts/updater-skill.mjs generate-latest-json.mjs",
  "release:mobile-config": "node scripts/updater-skill.mjs generate-mobile-update-config.mjs"
}
```

## 发版后验证清单

- [ ] `curl` latest.json 返回正确 `version`
- [ ] `platforms.windows-x86_64.url` 可 200 下载
- [ ] `signature` 非空
- [ ] 旧版安装包可检查并下载更新
- [ ] 开发模式 `pnpm tauri dev` 不测试 updater

## CI 示例（非交互）

```yaml
- run: pnpm release:cli --skip-bump --upload --notes "Release ${{ github.ref_name }}"
  env:
    GITCODE_TOKEN: ${{ secrets.GITCODE_TOKEN }}
    RELEASE_BASE_URL: https://api.gitcode.com/api/v5/repos/<owner>/<repo>/releases/${{ github.ref_name }}/attach_files
```

生成 `latest.json` 时：

```yaml
- run: node scripts/updater-skill.mjs generate-latest-json.mjs --version "$VERSION" --bundle-root artifacts
```

## 签名密钥生成

```bash
tauri signer generate -w ~/.tauri/<app-name>.key
tauri signer sign -w ~/.tauri/<app-name>.key -f <file>
# pubkey 内容写入 tauri.conf.json plugins.updater.pubkey
```
