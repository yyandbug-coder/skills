# tauri-app-updater

Tauri v2 **桌面应用**（Windows / macOS / Linux）的应用内自动更新与 GitHub / GitCode 双平台发版 Skill。

移动端不走 `tauri-plugin-updater`，不在本 Skill 范围内。

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/yyandbug-coder/skills/master/tauri-app-updater/install.mjs | node
```

已克隆仓库时：

```bash
node tauri-app-updater/install.mjs           # 复制安装
node tauri-app-updater/install.mjs --link    # 符号链接，改完立刻生效
```

装到 `~/.agents/skills/tauri-app-updater` 并当场验证。也可用 `npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y`。

## 接入项目

```bash
node <skill>/scripts/cli.mjs init
pnpm install
```

然后填 `release.config.json`，生成签名密钥并体检：

```bash
pnpm tauri signer generate -w .secrets/app.key --force --ci
pnpm release:doctor --fix-pubkey
```

## 日常发版

```bash
pnpm release          # 交互式向导
pnpm release:doctor   # 发版前体检
pnpm release:verify   # 发布后线上自检
```

详见 [SKILL.md](./SKILL.md)、[reference.md](./reference.md)、[pitfalls.md](./pitfalls.md)。
