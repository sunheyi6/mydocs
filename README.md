# 📚 我的知识库

个人知识库，基于 [VitePress](https://vitepress.dev/zh/) 构建（最新版 v2.0.0-alpha.18）。

用于记录、整理和沉淀日常学习、工作中的技术笔记、思考与积累。

---

## 🚀 快速开始

本项目使用 **pnpm** 作为包管理器。

```bash
# 安装依赖
pnpm install

# 启动本地开发服务器（默认 http://localhost:5173）
pnpm docs:dev

# 构建生产版本
pnpm docs:build

# 预览构建结果
pnpm docs:preview
```

---

## 📁 目录结构

```
mydocs/
├── README.md                    # 项目说明
├── package.json                 # 项目配置与依赖
├── pnpm-lock.yaml               # 依赖锁文件
└── src/                         # 文档源文件
    ├── .vitepress/              # VitePress 配置目录
    │   ├── config.ts            # 站点配置
    │   ├── public/              # 静态资源
    │   ├── cache/               # 缓存（自动生成）
    │   └── dist/                # 构建输出（自动生成）
    ├── index.md                 # 首页
    ├── guide/                   # 指南 / 文档
    ├── demo/                    # 示例 / 笔记
    ├── coding-agent/            # Coding Agent 笔记
    └── slides.md                # 幻灯片页面
```

---

## 🛠 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| [VitePress](https://vitepress.dev/zh/) | `2.0.0-alpha.18` | Vite & Vue 驱动的静态站点生成器 |
| [Vue 3](https://cn.vuejs.org/) | `^3.5.39` | 前端框架 |
| [pnpm](https://pnpm.io/zh/) | — | 包管理器 |

---

## ✨ 主要特性

- **📝 Markdown 扩展** — 支持 GFM、代码块行高亮、脚注、数学公式等
- **🎨 默认主题** — 深色模式、响应式布局、全文搜索
- **🔍 内置搜索** — 快速定位内容
- **📱 移动端适配** — 完美的移动端浏览体验
- **⚡ Vite 驱动** — 极速开发服务器启动和热更新

---

## 📝 使用方式

1. 在 `src/` 目录下创建 `.md` 文件即可自动生成对应页面
2. 通过 `src/.vitepress/config.ts` 中的 `themeConfig.sidebar` 和 `themeConfig.nav` 配置导航
3. 静态资源（图片等）放置在 `src/.vitepress/public/` 目录下

---

## 📄 License

MIT
