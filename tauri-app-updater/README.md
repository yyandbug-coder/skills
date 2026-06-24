# tauri-app-updater

Tauri v2 应用内自动更新与 GitCode / GitHub Release 交互式发版 Skill。

## 安装

```bash
npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y
# 或
pnpm dlx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y
```

## 接入项目

```bash
node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs
pnpm install
```

详见 [SKILL.md](./SKILL.md)、[reference.md](./reference.md)。

## Windows 说明

若 `pnpm release` 报 `SyntaxError` 且指向 `scripts/updater-skill.mjs` 中文乱码，请在项目根目录重新执行 `init-project.mjs` 以覆盖 wrapper（见 [pitfalls.md](./pitfalls.md#windows-发版脚本)）。
