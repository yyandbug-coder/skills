# kitty-tools 自动更新实现索引

## 发版 Skill（项目内，随 git 分发）

| 路径 | 说明 |
|------|------|
| `.cursor/skills/tauri-app-updater/scripts/` | 发版脚本（release、upload、latest.json） |
| `scripts/updater-skill.mjs` | 薄封装，自动查找项目/全局 Skill |
| `release.config.json` | 发版与 GitCode 配置 |

换电脑：`git clone` → `pnpm install` → `pnpm create:release`，无需单独装 Skill。

其他项目复用：

```bash
npx skills add yyandbug-coder/kitty-tools --skill tauri-app-updater -g -y
node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs
```

## 本项目配置

| 项 | 值 |
|----|-----|
| GitCode 仓库 | `yyandbug/kitty-tools` |
| GitHub 仓库 | `yyandbug-coder/kitty-tools` |
| 签名私钥 | `~/.tauri/kitty-tools.key` |
| 环境变量 | `KITTY_TOOLS_SIGNING_PRIVATE_KEY` |
| 发版文档 | `docs/RELEASE.md` |

## Rust 后端

| 文件 | 说明 |
|------|------|
| `src-tauri/src/app_updater.rs` | 更新检查/下载/安装 + fallback |
| `src-tauri/src/lib.rs` | 插件注册与命令挂载 |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater` native-tls |
| `src-tauri/tauri.conf.json` | updater pubkey + endpoints |

## 前端

| 文件 | 说明 |
|------|------|
| `src/lib/app-updater.ts` | invoke + Channel 封装 |
| `src/hooks/useAppUpdater.ts` | 关于页更新 Hook |
| `src/components/settings/SettingsAboutTab/index.tsx` | 关于页 UI |

## CI

| 文件 | 说明 |
|------|------|
| `.github/workflows/release.yml` | GitHub Actions |
| `.gitcode/workflows/release.yml` | GitCode CI |
