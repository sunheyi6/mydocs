---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "我的知识库"
  text: "记录学习、思考与积累"
  tagline: Agent 机制知识整理
  actions:
    - theme: brand
      text: 📖 开始阅读
      link: /agent/

features:
  - title: 🔧 工具调用
    details: Agent 如何选择与调用工具，参数校验与错误处理
    link: /agent/tool-usage
  - title: 🔄 循环
    details: 思考→行动→观察的迭代执行与循环控制
    link: /agent/loop
  - title: 📝 日志记录
    details: Agent 运行日志的收集、维度设计与存储方案
    link: /agent/logging
  - title: ⚡ 流式输出
    details: 流式响应、实时交互与状态同步机制
    link: /agent/streaming
  - title: 🗃️ 缓存使用
    details: 三级缓存层级、LRU/TTL 策略与缓存失效
    link: /agent/cache
  - title: 📦 上下文压缩
    details: 滑动窗口、摘要压缩与 Token 预算分配
    link: /agent/context-compression
---
