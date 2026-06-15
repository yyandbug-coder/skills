# yyandbug-coder/skills

个人 Agent Skills 合集，可通过 [Skills CLI](https://skills.sh/) 安装。

## 安装

```bash
# 安装单个 skill（全局）
npx skills add yyandbug-coder/skills --skill <skill-name> -g -y

# pnpm
pnpm dlx skills add yyandbug-coder/skills --skill <skill-name> -g -y

# 安装全部
npx skills add yyandbug-coder/skills --skill '*' -g -y
```

## 可用 Skills

| Skill | 说明 | 安装 |
|-------|------|------|
| [tauri-app-updater](./tauri-app-updater/) | Tauri v2 自动更新与发版（桌面 + 移动端） | `npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y` |

## 添加新 Skill

在仓库根目录新建 `<skill-name>/SKILL.md`，提交并 push 即可。

```
skills/
├── README.md
├── tauri-app-updater/
│   └── SKILL.md
└── your-new-skill/
    └── SKILL.md
```

## 发布

```bash
node scripts/publish.mjs
```

仓库：<https://github.com/yyandbug-coder/skills>
