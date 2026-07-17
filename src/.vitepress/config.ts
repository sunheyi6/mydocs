import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: '我的知识库',
  description: '个人知识库 - Agent 机制知识整理',
  base: '/',

  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: 'Agent', link: '/agent/' },
    ],

    sidebar: {
      '/': [
        {
          text: '首页',
          link: '/'
        },
        {
          text: 'Agent 机制',
          link: '/agent/',
          items: [
            { text: '🔧 工具调用', link: '/agent/tool-usage' },
            { text: '🔄 循环', link: '/agent/loop' },
            { text: '📝 日志记录', link: '/agent/logging' },
            { text: '⚡ 流式输出', link: '/agent/streaming' },
            { text: '🗃️ 缓存使用', link: '/agent/cache' },
            { text: '📦 上下文压缩', link: '/agent/context-compression' }
          ]
        }
      ]
    },

    footer: {
      message: '基于 VitePress 构建',
      copyright: 'MIT License'
    },

    editLink: {
      pattern: 'https://github.com/vuejs/vitepress/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ]
  }
})
