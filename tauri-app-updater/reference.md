# tauri-app-updater — 配置参考

## 目录结构

Skill（每台机器装一次，所有项目共用）：

```
tauri-app-updater/
├── SKILL.md · reference.md · pitfalls.md
├── templates/
│   ├── release.config.json
│   └── updater-skill.mjs          # init 写进项目的薄 wrapper
└── scripts/
    ├── cli.mjs                    # 唯一入口
    ├── commands/                  # wizard / release / doctor / manifest / upload / verify / init
    └── lib/                       # project · signing · platforms · manifest · targets · git · notes · doctor · http · upload/
```

项目侧只有两样东西：

```
project/
├── release.config.json
└── scripts/updater-skill.mjs      # 由 init 生成
```

> **不要把 Skill 的 `scripts/` 复制进项目**。wrapper 的解析顺序是**全局优先**，就是为了避免
> 项目里的陈旧副本悄悄盖住已更新的 Skill。要指定位置用 `TAURI_UPDATER_SKILL_ROOT`。

## release.config.json

```json
{
  "appName": "Your App",
  "primaryTarget": "gitcode",
  "signing": {
    "privateKeyPath": ".secrets/app.key",
    "privateKeyPassword": "",
    "envKeyVar": "TAURI_SIGNING_PRIVATE_KEY",
    "envPasswordVar": "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
  },
  "build": {
    "default": "pnpm tauri build",
    "darwin-universal": "pnpm tauri build --target universal-apple-darwin"
  },
  "notesCommand": "node scripts/release-notes.mjs --notes {version}",
  "checkCommands": ["node scripts/release-notes.mjs --check {version}"],
  "github": { "owner": "", "repo": "", "defaultBranch": "master" },
  "gitcode": { "owner": "", "repo": "", "apiUrl": "https://api.gitcode.com/api/v5", "defaultBranch": "master" }
}
```

| 字段 | 说明 |
|------|------|
| `appName` | 缺省取 `tauri.conf.json` 的 `productName` |
| `primaryTarget` | 提交进仓库的 `releases/latest.json` 用哪个目标的 URL 规则；不填按配置顺序取第一个 |
| `signing.privateKeyPath` | 相对项目根或绝对路径，支持 `~`。**找不到就直接报错**，不会 fallback 到别处 |
| `signing.envKeyVar` | CI 里把私钥**正文**放进该变量即可（内容含 `untrusted comment` 时按正文处理） |
| `build.<平台id>` | 该平台的构建命令；`{target}` 会替换成 rust triple。缺省按探测到的包管理器自动拼 |
| `build.default` | 所有未单独配置的平台用它 |
| `notesCommand` | 取发布说明的命令，stdout 即 notes。`{version}` / `{tag}` 会被替换 |
| `checkCommands` | 发版前必须通过的项目自定义校验（典型：changelog 有本版本条目）。任一失败即中止 |

**签名私钥由 Skill 自动注入构建子进程**（先剥掉继承来的 `TAURI_SIGNING_*` 再写入本项目的），
所以 `build` 里直接写 `pnpm tauri build` 即可，不需要项目再包一层注入签名的脚本。

## 平台矩阵

`--platform` 可多选（逗号分隔或重复传参）。

| id | 构建 target | latest.json 的 key |
|----|-------------|-------------------|
| `host` | 不指定（当前主机） | 按本机 os-arch 推断 |
| `windows-x86_64` | `x86_64-pc-windows-msvc` | `windows-x86_64` |
| `windows-aarch64` | `aarch64-pc-windows-msvc` | `windows-aarch64` |
| `darwin-aarch64` | `aarch64-apple-darwin` | `darwin-aarch64` |
| `darwin-x86_64` | `x86_64-apple-darwin` | `darwin-x86_64` |
| `darwin-universal` | `universal-apple-darwin` | **`darwin-aarch64` + `darwin-x86_64`** |
| `linux-x86_64` | `x86_64-unknown-linux-gnu` | `linux-x86_64` |

简写：`desktop`→`host`，`windows`→`windows-x86_64`，`macos`→`darwin-universal`，`linux`→`linux-x86_64`。

**macOS 建议直接发 `darwin-universal`**：一个包覆盖两种架构，且是唯一能让 Intel 与 Apple Silicon
都收到更新的做法。需要先 `rustup target add x86_64-apple-darwin aarch64-apple-darwin`。

### updater 包的识别顺序

| 平台 | 认哪个文件 |
|------|-----------|
| Windows | `*-setup.exe`（NSIS，优先）→ `*.msi`（WiX） |
| macOS | `*.app.tar.gz` |
| Linux | `*.AppImage.tar.gz` → `*.AppImage` |

必须有同名 `.sig` 才会进 manifest；`.dmg` 只作为人工下载附件上传，不参与自动更新。

## 自建更新服务器（`custom`）

发版流水线里跟托管方绑定的只有两处：**安装包 URL 规则**和**上传动作**。前者是个模板，
后者各家（S3 / OSS / rsync / scp / curl）完全不同 —— 所以 URL 内建，上传交给你的命令。
构建、签名、验签名、manifest、发布后探活全部照常。

```json
"custom": {
  "label": "自建服务器",
  "baseUrl": "https://dl.example.com/releases/{tag}",
  "endpoint": "https://dl.example.com/releases/latest.json",
  "uploadCommand": "rsync -av --delete {dir}/ deploy@host:/var/www/releases/{tag}/"
}
```

| 字段 | 说明 |
|------|------|
| `baseUrl` | 安装包所在目录。支持 `{tag}`（`v1.2.0`）/ `{version}`（`1.2.0`）；不写占位就是固定目录（每次覆盖，适合只留最新版的部署） |
| `endpoint` | `latest.json` 地址。留空则自动取 `baseUrl` 去掉版本段后的同级 `latest.json` |
| `uploadCommand` | 上传命令。占位：`{dir}` 待上传目录、`{version}`、`{tag}`、`{baseUrl}`。**失败即中止发版** |
| `label` | 体检/日志里的显示名 |

`{dir}` 是一个**干净的待上传目录**（`releases/v{version}/.upload/`），里面只有该传的文件，
文件名与 manifest 里的 URL 严格一致，`latest.json` 排在最后。直接整目录推走即可：

```bash
aws s3 sync {dir}/ s3://bucket/releases/{tag}/ --delete
ossutil cp -r {dir}/ oss://bucket/releases/{tag}/ --update
scp -r {dir}/. deploy@host:/var/www/releases/{tag}/
```

鉴权（ssh key / aws 凭证 / token header）在你的命令内部，Skill 不碰也不该碰。

`custom` 可以和 `github` / `gitcode` 并存 —— 三个目标各拿一份指向自己的 `latest.json`，
`tauri.conf.json` 的 `endpoints` 按顺序容灾。

### 静态 vs 动态 manifest

插件两种都认，`doctor` / `verify` 也都认：

| | 形状 | 适用 |
|---|---|---|
| 静态 | `{ version, platforms: { "darwin-aarch64": { url, signature } } }` | 对象存储 / Release 附件，本 Skill 生成的就是这种 |
| 动态 | `{ version, url, signature }` | 自建服务端按请求里的 `{{target}}` / `{{arch}}` / `{{current_version}}` 自己挑包，还能返回 **204 表示无更新** |

动态的好处是能做灰度（按 current_version 或百分比决定给不给更新），代价是要自己写服务端。
Skill 只负责生成静态那份；你若改用动态，`verify` 会识别并只探测服务端返回的那一条 URL。

## 包管理器

按 `package.json` 的 `packageManager` 字段 → lockfile → 默认 `pnpm` 探测，影响默认构建命令与所有提示文案。

**npm 的参数透传是特例**：`npm run tauri build --target X` 里的 `--target` 会被 npm 自己当成选项吃掉，
必须写成 `npm run tauri -- build --target X`。Skill 生成的命令已按此处理，手写 `build.*` 时也要注意。

## tauri.conf.json

`doctor --fix`（或 `--fix-config`）会按 `release.config.json` 里已配置的 owner/repo 自动补出下面这份。
只做加法：已有的 endpoints 会保留并去重（自建镜像不会被抹掉）。

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<.secrets/app.key.pub 的内容>",
      "endpoints": [
        "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/releases/latest/attach_files/latest.json/download",
        "https://github.com/{owner}/{repo}/releases/latest/download/latest.json"
      ],
      "windows": { "installMode": "passive" }
    }
  }
}
```

`endpoints` 按顺序尝试，任一返回可解析的 manifest 即停。`doctor` 会逐个实拉，**死端点会被标红** ——
主端点正常时没人会发现备用端点早就 404 了。

capabilities 需要：`updater:default`、`process:allow-restart`。

## URL 规则

| | latest.json 端点 | 安装包 URL |
|---|---|---|
| GitHub | `https://github.com/{o}/{r}/releases/latest/download/latest.json` | `https://github.com/{o}/{r}/releases/download/v{ver}/{file}` |
| GitCode | `{api}/repos/{o}/{r}/releases/latest/attach_files/latest.json/download` | `{api}/repos/{o}/{r}/releases/v{ver}/attach_files/{file}/download` |

文件名一律 `encodeURIComponent`（应用名普遍带空格）。

## Rust 侧

```rust
// Windows 上 install() 是 on_before_exit() → ShellExecuteW → std::process::exit(0)。
// 不注册钩子，数据库 flush / 热键注销 / 配置回写全部跳过。
tauri_plugin_updater::Builder::new()
    .on_before_exit(|| { /* 关数据库、注销全局热键、落盘配置 */ })
    .build()
```

前端 `downloadAndInstall()` 之后：

- **macOS**：包已就地替换，需要自己 `relaunch()`
- **Windows**：进程已被 `exit(0)` 结束，`relaunch()` 那行**永远执行不到**；NSIS 靠 `/UPDATE` 参数自行重启

## 环境变量

| 变量 | 用途 |
|------|------|
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub 上传（需 contents:write） |
| `GITCODE_TOKEN` | GitCode 上传 |
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥正文或路径，覆盖配置 |
| `TAURI_UPDATER_SKILL_ROOT` | 指定 Skill 位置 |
| `TAURI_UPDATER_PROJECT_ROOT` | 指定项目根 |

项目根的 `.env` 会被自动读取（不覆盖已有的 `process.env`）。`.env` 必须进 `.gitignore`。
