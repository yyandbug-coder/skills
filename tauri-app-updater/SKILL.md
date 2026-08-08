---
name: tauri-app-updater
description: >-
  Tauri v2 桌面应用（Windows / macOS / Linux）的应用内自动更新与 GitHub / GitCode 双平台发版。
  涵盖 latest.json 生成、更新签名密钥校验、Release 上传、发布后线上自检、发版向导与 CI 用法。
  在用户提及 Tauri 更新、发版、打包上传、latest.json、updater 报错、签名密钥不匹配、
  「检测到新版本但下载失败」、GitCode / GitHub Release 或 release 脚本时使用。
---

# Tauri 桌面应用自动更新与发版

**仅覆盖桌面端**（Windows / macOS / Linux）。移动端不走 `tauri-plugin-updater`，不在本 Skill 范围内。

## 红线速查

动手前先确认这几条，它们对应的都是「发出去之后才会暴露」的事故：

| 红线 | 为什么 |
|------|--------|
| **每个发版平台必须有指向自己的 `latest.json`** | 传同一份到 GitHub + GitCode，从 GitHub 拉到的 URL 仍指向 GitCode → 「双平台容灾」名存实亡 |
| **`darwin-universal` 不是有效的 platform key** | 插件按运行时 `{os}-{arch}` 查表，只会是 `darwin-aarch64` / `darwin-x86_64`。universal 包必须同时挂到两个 key |
| **macOS 缺哪个 arch，那批用户就报错而不是「已是最新」** | `get_urls()` 在版本比对**之前**执行，缺 key 直接抛 `TargetNotFound` |
| **`.sig` 的 keynum 必须等于 `tauri.conf.json` 的 pubkey** | 签错 key 的包能上传、能被检测到，只有用户点安装才报 `signature created with a different key` |
| **`latest.json` 必须最后上传** | 它一出现，客户端立刻按它下载；先传 manifest 后传包 = 中间那段时间用户拿到 HTTP 500 |
| **Windows 上 `install()` 会 `std::process::exit(0)`** | 要清理（数据库 flush、注销热键）必须注册 `on_before_exit`，`downloadAndInstall()` 之后的代码在 Windows 永远执行不到 |
| **GitCode 不覆盖同名附件** | 重发同一版本必须 `--replace`，否则用户下到的还是旧包 |
| **发版后必须跑 `verify`** | GitCode 对缺失附件返回 **500 而不是 404**，光看 latest.json 查不出来 |

## 命令

```bash
pnpm release                 # 交互式向导（默认）
pnpm release:doctor          # 发版前体检；--fix 自动补 updater 配置与 pubkey
pnpm release:verify          # 发布后线上自检
```

底层 CLI（向导只是给它拼参数）：

```bash
node scripts/updater-skill.mjs release --part patch --platform host --publish
node scripts/updater-skill.mjs doctor --fix-pubkey
node scripts/updater-skill.mjs manifest --version 0.1.13 --platform host,windows-x86_64
node scripts/updater-skill.mjs upload --version 0.1.13 --replace
node scripts/updater-skill.mjs verify --version 0.1.13
```

CI（非交互）：

```bash
node scripts/updater-skill.mjs release --set-version "$VERSION" --platform windows-x86_64 --publish
```

## 流水线

`release` 的阶段固定，每一步都在**造成外部副作用之前**失败：

```
体检 → 项目校验(changelog) → 定版本 → 构建(自动注入签名私钥)
     → 收产物 → 验签名 → 逐目标生成 manifest
     → git tag/push → 逐目标上传 → 线上自检
```

版本号在「已 push 或已上传」之前失败会自动回退；之后失败不回退（本地与远端不一致更难收拾）。

## 安装（每台机器一次）

```bash
# 远程
curl -fsSL https://raw.githubusercontent.com/yyandbug-coder/skills/master/tauri-app-updater/install.mjs | node

# 已克隆仓库
node tauri-app-updater/install.mjs           # 复制安装
node tauri-app-updater/install.mjs --link    # 符号链接（开发 Skill 本身时用）
```

装到 `~/.agents/skills/tauri-app-updater`，也就是项目 wrapper 的第一顺位查找路径；
装完会当场跑一次 `cli.mjs --help` 验证。`--dir` 可改安装位置。

## 发版目标

支持三种，可并存 —— 各拿一份指向自己的 `latest.json`，`endpoints` 按序容灾：

| | 上传方式 |
|---|---|
| `github` | Release API（需 `GITHUB_TOKEN`） |
| `gitcode` | Release API（需 `GITCODE_TOKEN`） |
| `custom` | **自建服务器**：`baseUrl` 定 URL 规则，`uploadCommand` 由你提供（rsync / aws s3 / ossutil / scp 都行） |

自建的鉴权在你的命令内部，Skill 不碰。详见 [reference.md](reference.md) 的「自建更新服务器」。

## 接入新项目

```bash
node <skill>/scripts/cli.mjs init        # 写 wrapper + release.config.json + package.json scripts
# 1. 装依赖
# 2. 填 release.config.json 的 github / gitcode 的 owner、repo
# 3. 生成签名密钥（init 会按本项目的包管理器打印确切命令）
#    tauri signer generate -w .secrets/app.key --force --ci
# 4. .secrets/ 与 .env 加进 .gitignore
pnpm release:doctor --fix                # 自动补 updater 配置 + 同步 pubkey，然后体检
```

`doctor --fix` 会按已配置的 owner/repo **推导出两个 endpoint 写进 `tauri.conf.json`**，
并补上 `createUpdaterArtifacts`、`windows.installMode`、`pubkey`。这几样手抄极易出错——
GitCode 与 GitHub 的 endpoint 路径形状完全不同，抄错要等第一次发版才发现。

**包管理器自动探测**（`packageManager` 字段 → lockfile → 默认 pnpm），
生成的构建命令与提示都按探测结果走。npm 项目会正确生成 `npm run tauri -- build --target X`
这种形式（少了 `--`，参数会被 npm 自己吃掉）。

**旧版 `release.config.json` 会直接报错**并列出字段映射，不会静默退回默认值构建错东西。

## 附加资源

- 配置字段与平台矩阵：[reference.md](reference.md)
- 故障排查：[pitfalls.md](pitfalls.md)
