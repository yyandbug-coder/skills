# tauri-app-updater — 故障排查

先跑 `pnpm release:doctor`（发版前）或 `pnpm release:verify`（发版后）。
下面大部分症状这两条命令会直接指出来。

## 客户端：检查更新失败

| 症状 | 原因 | 处理 |
|------|------|------|
| `TargetNotFound` / 某些机器一直报错 | `latest.json` 里没有该 `{os}-{arch}` 的 key。**注意插件是在版本比对之前取 URL 的**，所以缺 key 的机器连「已是最新」都走不到 | macOS 发 `--platform darwin-universal`（一个包同时挂 `darwin-aarch64` + `darwin-x86_64`）；Windows ARM 补 `windows-aarch64` |
| 所有端点都失败 | endpoints 里的地址返回非 2xx。**死端点是静默的**：主端点正常时没人会发现备用端点早就 404 | `pnpm release:doctor` 会逐个实拉并标红 |
| 开发模式检查不到更新 | `import.meta.env.DEV` 下应主动禁用 | 用正式安装包测 |
| `decoding response body` | 端点返回的不是 manifest（常见于 404 页面） | 核对 endpoint 路径与 owner/repo |

## 客户端：能检测到新版本，下载失败

| 症状 | 原因 | 处理 |
|------|------|------|
| **HTTP 500** | 安装包**没上传到 Release**。GitCode 对缺失附件返回 500 而不是 404，manifest 本身完全正常，光看 latest.json 查不出来 | `pnpm release:verify` 会 HEAD 每个 `platforms.*.url`；补传后 `upload --replace` |
| 下到的是上一版的包 | GitCode / GitHub **不覆盖同名附件**，重发同版本时旧文件还在 | 重发同一版本必须 `--replace` |
| `signature created with a different key` | 构建用的私钥与 `tauri.conf.json` 的 pubkey 不是同一把 | `release` 会在上传前逐个比对 `.sig` 的 keynum 并中止。手工排查：`doctor` |
| 下载 0B 后失败（Windows） | 默认 `rustls-tls` 在部分 Windows 环境不稳定 | `tauri-plugin-updater` 改 `default-features = false, features = ["native-tls"]` |
| 权限错误 | capabilities 缺 `updater:default` / `process:allow-restart` | 补进 `capabilities/*.json` |

## 安装与重启

| 症状 | 原因 | 处理 |
|------|------|------|
| Windows 装更新后数据丢失 / 配置没保存 | `install()` 是 `on_before_exit()` → `ShellExecuteW` → **`std::process::exit(0)`**，不注册钩子就没有任何清理机会 | `Builder::new().on_before_exit(\|\| { ... })` 里关数据库、注销热键、落盘 |
| Windows 上 `downloadAndInstall()` 之后的代码没执行 | 同上，进程已经没了 | 这是预期行为；NSIS 靠 `/UPDATE` 自行重启。`relaunch()` 只对 macOS 有意义 |
| macOS 装完不重启 | macOS 只是就地替换 `.app`，不会自己重启 | 自行调用 `relaunch()` |
| macOS 更新失败且无提示 | `.app` 所在目录不可写（如 `/Applications` 属主是别人） | 需要用户手动重装一次 |

## 构建与签名

| 症状 | 原因 | 处理 |
|------|------|------|
| 产物没有 `.sig` | `createUpdaterArtifacts` 没开，或构建时没注入签名私钥 | 本 Skill 会自动注入；若 `build` 里配了自己的脚本，确认它没把 `TAURI_SIGNING_*` 覆盖掉 |
| 私钥找不到 | `signing.privateKeyPath` 没配 | **不会 fallback**，直接报错并给出生成命令。旧版会悄悄退到一个不存在的 `~/.tauri/app.key`，于是静默产出无 `.sig` 的包 |
| keynum 对不上但密钥没换过 | `src-tauri/target/**/bundle` 里残留了上次用别的 key 签的产物 | 删掉对应 bundle 目录重新构建 |
| 换了 pubkey 之后老用户更新不了 | 老客户端内置的是旧 pubkey，验不了新签名 | 无法补救，老用户必须手动重装一次。`doctor --fix-pubkey` 改动 pubkey 时会明确警告 |

## 上传与发版

| 症状 | 原因 | 处理 |
|------|------|------|
| `缺少 GITCODE_TOKEN` 但已设置 | PowerShell 用 `$env:X="v"`（不是 bash 的 `export`）；或换了终端会话 | 写进项目根 `.env`，Skill 会自动读 |
| `tag 已存在` | 重发同版本时还带了 `--push` | 重发只用 `--upload`；确实要重打先 `git tag -d` |
| 构建失败后版本号停在新版本 | — | 已自动回退。**已 push 或已上传之后不回退**（本地与远端不一致更难收拾） |
| changelog 忘了写 | — | 配 `checkCommands`，发版前直接拦下 |
| 发布说明是 `App release v0.1.12` 这种废话 | 没配 `notesCommand`，用了默认文案。**这串字符会原样出现在用户的更新提示里** | 配 `notesCommand` 从项目 changelog 取 |
| 从 GitHub 端点拉到的 URL 指向 GitCode | 把同一份 `latest.json` 传给了两个平台 | 本 Skill 逐目标生成；`verify` 会校验 URL 归属 |

## Skill 本身

| 症状 | 原因 | 处理 |
|------|------|------|
| 报错指向 Skill 里不存在的函数 / 选项对不上 | 项目里有一份**陈旧的 Skill 副本**盖住了全局的 | wrapper 现在是**全局优先**。删掉项目里的 `scripts/` 副本；要指定位置用 `TAURI_UPDATER_SKILL_ROOT` |
| Windows 上 `SyntaxError: Invalid or unexpected token` | `.mjs` 被存成 GBK/UTF-16 | wrapper 模板是 ASCII-only；重跑 `init` 覆盖 |
| `spawnSync pnpm ENOENT` | pnpm 不在 PATH | `corepack enable` |
| 向导启动不了 | 缺 `@clack/prompts`，或不在 Unicode TTY 里 | `pnpm add -D @clack/prompts`；CI 用 `release` 子命令 |

## 重发同一版本

```bash
pnpm release:cli --skip-build --upload --replace     # 复用已有产物，覆盖远端同名附件
pnpm release:verify                                   # 确认每个包都真的能下
```

`--replace` 会先删远端同名附件再传。GitCode 若不返回附件列表，会明确提示需要手动删除，
**不会假装成功**。
