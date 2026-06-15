# 发版指南（模板）

> 复制到项目的 `docs/RELEASE.md`，按实际应用名与 GitCode 仓库修改占位符。

## 安装 Skill（其他 Tauri 项目）

```bash
npx skills add yyandbug-coder/kitty-tools --skill tauri-app-updater -g -y
node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs
pnpm install
```

---

# Kitty Tools 发版指南

本文档说明如何打包桌面安装包、生成自动更新清单，以及上传到 GitCode Release。

推荐优先使用 **交互式发版向导**（体验类似 `npm create vite@latest`）。

---

## 快速开始

```bash
pnpm create:release
```

或：

```bash
pnpm release:interactive
```

终端会逐步引导你选择：

1. 发版操作（仅打包 / 打包并上传 / 仅上传 / 预览）
2. 版本号策略（保持当前 / 指定 / 自动递增）
3. 更新说明
4. 是否推送 Git tag（上传时可选）
5. 确认摘要后执行

---

## 前置准备

### 1. 签名私钥（自动更新必需）

构建 NSIS/MSI 安装包时需要签名，否则不会生成 `.sig`，应用内更新会失败。

默认路径：

```
~/.tauri/kitty-tools.key
```

可在 `release.config.json` 中修改：

```json
{
  "signing": {
    "privateKeyPath": "~/.tauri/kitty-tools.key",
    "privateKeyPassword": ""
  }
}
```

也可通过环境变量覆盖：

```bash
# Windows PowerShell
$env:KITTY_TOOLS_SIGNING_PRIVATE_KEY = "C:\path\to\kitty-tools.key"
$env:KITTY_TOOLS_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

### 2. GitCode Token（上传时需要）

在 GitCode 创建 Personal Access Token，并设置环境变量：

```bash
# Windows PowerShell
$env:GITCODE_TOKEN = "你的Token"
```

仓库信息默认在 `release.config.json`：

```json
{
  "gitcode": {
    "owner": "yyandbug",
    "repo": "kitty-tools"
  }
}
```

---

## 交互式发版

### 启动命令

| 命令 | 说明 |
|------|------|
| `pnpm create:release` | 交互式发版向导（推荐） |
| `pnpm release:interactive` | 同上 |

### 交互流程示意

无论选择哪种发版操作，都会进入 **版本号策略** 步骤，可指定任意版本：

```
┌  Kitty Tools 发版向导
│
◇  选择发版操作
│  ● 仅打包
│  ○ 打包并上传
│  ○ 仅上传已有产物
│  ○ 预览流程
│
◇  版本号策略
│  ○ 保持当前版本 v0.1.2
│  ● 指定版本号          ← 可手动输入，如 0.1.3
│  ○ 自动递增 patch
│  ○ 自动递增 minor
│  ○ 自动递增 major
│
◇  输入目标版本号
│  0.1.3
│
◇  更新说明（Release notes）
│  Kitty Tools release
│
◇  确认开始执行？
│  ● 是
│
└  发版完成
```

### 四种发版操作

| 操作 | 构建 | 上传 | 适用场景 |
|------|------|------|----------|
| 仅打包 | ✅ | ❌ | 本地测试安装包 |
| 打包并上传 | ✅ | ✅ | 正式发布给用户 |
| 仅上传已有产物 | ❌ | ✅ | 已 build 过，只补传 |
| 预览流程 | ❌ | ❌ | 查看将执行什么，不实际运行 |

---

## 命令行发版（非交互）

适合 CI 或脚本化场景。入口：

```bash
pnpm release [options]
```

### 常用参数

| 参数 | 说明 |
|------|------|
| `--skip-bump` | 不修改版本号，使用当前版本 |
| `--set-version 0.1.3` | 指定目标版本 |
| `--part patch` | 自动递增 patch（还有 `minor` / `major`） |
| `--skip-build` | 跳过 `pnpm tauri build` |
| `--upload` | 上传到 GitCode Release |
| `--push` | 提交代码、打 tag、`git push` |
| `--publish` | 等价于 `--push --upload` |
| `--notes "说明文字"` | Release 更新说明 |
| `--dry-run` | 仅预览，不实际执行 |

### 场景示例

#### 1. 仅打包当前版本（不上传）

```bash
pnpm release --skip-bump
```

#### 2. 打包指定版本（不上传）

```bash
pnpm release --set-version 0.1.2
```

#### 3. 打包当前版本并上传

```bash
$env:GITCODE_TOKEN = "你的Token"
pnpm release --skip-bump --upload --notes "修复更新下载"
```

#### 4. 升版本、打包、上传

```bash
$env:GITCODE_TOKEN = "你的Token"
pnpm release --part patch --upload --notes "新功能"
```

#### 5. 完整发布（构建 + 上传 + 推 tag）

```bash
$env:GITCODE_TOKEN = "你的Token"
pnpm release --part patch --publish --notes "正式发版"
```

#### 6. 仅上传已有产物

```bash
$env:GITCODE_TOKEN = "你的Token"
pnpm release --skip-bump --skip-build --upload
```

#### 7. 预览将执行的步骤

```bash
pnpm release --dry-run --skip-bump --upload
```

---

## 辅助命令

| 命令 | 说明 |
|------|------|
| `pnpm tauri build` | 仅构建，不整理产物 |
| `pnpm release:json -- --version 0.1.2 --notes "说明"` | 仅生成 `releases/latest.json` |
| `pnpm release:upload -- --tag v0.1.2` | 仅上传 `releases/artifacts/` |
| `pnpm release:dry-run` | 预览默认发版流程 |

---

## 产物说明

执行 `pnpm release` 或交互式向导后，主要产物位置：

```
releases/
├── latest.json              # 自动更新清单（updater 读取）
└── artifacts/               # 待上传的 Release 资源
    ├── Kitty Tools_0.1.2_x64-setup.exe
    ├── Kitty Tools_0.1.2_x64-setup.exe.sig
    ├── Kitty Tools_0.1.2_x64_zh-CN.msi      # 如有
    ├── Kitty Tools_0.1.2_x64_zh-CN.msi.sig
    └── latest.json

src-tauri/target/release/bundle/
├── nsis/                    # 原始 NSIS 安装包
└── msi/                     # 原始 MSI 安装包
```

`tauri.conf.json` 中 updater 端点：

```
https://api.gitcode.com/api/v5/repos/yyandbug/kitty-tools/releases/latest/attach_files/latest.json/download
```

---

## 重发同一版本注意事项

若 GitCode 上 **v0.1.2** 已存在同名附件，上传脚本会跳过已存在文件，**不会覆盖**。

重发前请先到 GitCode Release 页面：

1. 删除旧的 `.exe`、`.msi`、`.sig`、`latest.json`
2. 或删除整个 Release 后重新上传

然后再执行：

```bash
pnpm create:release
# 选择：打包并上传 → 保持当前版本
```

---

## 发版后验证

### 1. 检查 latest.json

```bash
curl -sL "https://api.gitcode.com/api/v5/repos/yyandbug/kitty-tools/releases/latest/attach_files/latest.json/download"
```

确认 `version` 与 `platforms.windows-x86_64.url` 正确。

### 2. 应用内验证

1. 安装旧版本（如 v0.1.1）
2. 打开 **设置 → 关于**
3. 点击 **检查更新**
4. 点击 **下载并安装**

---

## 常见问题

### Q: 开发模式能测试更新吗？

不能。自动更新仅在 **正式安装包**（`pnpm tauri build` 产物）中可用，`pnpm tauri dev` 下会提示使用正式安装包测试。

### Q: 构建警告「未找到签名私钥」？

确认 `~/.tauri/kitty-tools.key` 存在，或设置 `KITTY_TOOLS_SIGNING_PRIVATE_KEY`。

### Q: 上传失败「缺少 GITCODE_TOKEN」？

```bash
$env:GITCODE_TOKEN = "你的Token"
```

### Q: `git tag v0.1.2` 已存在？

不要用 `--push`。仅执行 `--upload`，或删除远程 tag 后再 `--publish`。

### Q: 下载更新报 `error sending request for url`？

确保上传的是包含更新下载修复的新构建包，且 GitCode 上的 `latest.json` 与安装包已更新。

---

## 命令速查表

| 我想… | 交互式 | 命令行 |
|-------|--------|--------|
| 本地打包测试 | `pnpm create:release` → 仅打包 | `pnpm release --skip-bump` |
| 打包指定版本 | → **指定版本号** → 输入如 `0.1.3` | `pnpm release --set-version 0.1.3` |
| 打包并上传 | → 打包并上传 | `pnpm release --skip-bump --upload` |
| 发新版本 | → 自动递增 patch | `pnpm release --part patch --upload` |
| 只上传不构建 | → 仅上传 → **指定版本号** | `pnpm release --set-version 0.1.3 --skip-build --upload` |
| 预览流程 | → 预览流程 | `pnpm release --dry-run` |
