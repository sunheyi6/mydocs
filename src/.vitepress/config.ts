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
            {
              text: '核心文档',
              collapsed: false,
              items: [
                { text: '循环', link: '/agent/loop' },
                { text: '提示词', link: '/agent/prompt-thinking' },
                { text: '任务规划', link: '/agent/planning-thinking' },
                { text: '完成判断', link: '/agent/completion-thinking' },
                { text: '上下文压缩', link: '/agent/context-compression' },
                { text: '记忆', link: '/agent/memory-thinking' },
                { text: '失败教训', link: '/agent/lessons-thinking' },
                { text: '引导注入', link: '/agent/guidance-thinking' },
                { text: '运行日志', link: '/agent/logging-thinking' },
                { text: '日志原则', link: '/agent/logging' }
              ]
            },
            {
              text: '工具和界面',
              collapsed: true,
              items: [
                { text: '工具调用', link: '/agent/tool-calling-thinking' },
                { text: '工具使用', link: '/agent/tool-usage' },
                { text: 'Bash', link: '/agent/bash-thinking' },
                { text: 'Edit', link: '/agent/edit-thinking' },
                { text: 'Grep', link: '/agent/grep-thinking' },
                { text: 'Write', link: '/agent/write-thinking' },
                { text: '工具操作展示', link: '/agent/operation-thinking' },
                { text: '流式输出', link: '/agent/streaming' },
                { text: '流式进度', link: '/agent/progress-thinking' },
                { text: '调用链', link: '/agent/calltrace-thinking' }
              ]
            },
            {
              text: '状态和体验',
              collapsed: true,
              items: [
                { text: '项目状态', link: '/agent/project-thinking' },
                { text: '会话', link: '/agent/session-thinking' },
                { text: '缓存', link: '/agent/cache' },
                { text: '模型前缀缓存', link: '/agent/prefix-cache-thinking' },
                { text: 'Token', link: '/agent/token-thinking' },
                { text: '输入框', link: '/agent/input-thinking' },
                { text: '悬浮面板', link: '/agent/floating-panel-thinking' }
              ]
            }
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
