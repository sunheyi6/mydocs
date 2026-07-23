---
title: Agent 经验总结
---

# Agent 经验总结

这里记录的不是某个项目的代码说明，而是从真实 Agent 系统里抽出来的通用经验。

## 先记住一件事

Agent 不是“一问一答”。它更像一个小型执行团队：

`理解任务 → 找信息 → 调工具 → 看结果 → 继续或结束`

每一步都可能出错，所以好的 Agent 不只靠模型能力，还要有上下文保护、工具边界、失败记录、日志和明确的结束信号。

## 核心文档

| 文档 | 主要回答的问题 |
|---|---|
| [循环](./loop) | Agent 为什么要一轮一轮执行？什么时候继续？ |
| [长任务不丢注意力](./long-task-thinking) | 任务长于一次运行、甚至长于进程存活时，怎么始终记得目标？ |
| [提示词](./prompt-thinking) | 怎样把角色、规则和工具纪律说清楚？ |
| [任务规划](./planning-thinking) | 为什么复杂任务要先拆步骤？ |
| [完成判断](./completion-thinking) | 为什么模型停了，不代表事情做完了？ |
| [多 Agent 协作](./multi-agent-thinking) | 怎么让多个 Agent 一起干活，又不让子 Agent 失控？ |
| [上下文压缩](./context-compression) | 对话太长时，怎样保住任务重点？ |
| [记忆](./memory-thinking) | 什么内容值得跨会话保存？ |
| [失败教训](./lessons-thinking) | 怎样避免下一次重复同一个错误？ |
| [引导注入](./guidance-thinking) | 用户中途补充要求时，怎样不丢进度？ |
| [运行日志](./logging-thinking) | 出问题后，怎样还原 Agent 做过什么？ |
| [日志原则](./logging) | 记事实不记猜测，日志怎么分层、脱敏、限量？ |
| [Log-First 架构](./log-first-thinking) | 日志为什么是运行时本身，而不只是排障用的旁路记录？ |

## 工具和界面

| 文档 | 主要回答的问题 |
|---|---|
| [工具调用](./tool-calling-thinking) | 模型如何请求工具，工具如何返回结果？ |
| [工具使用](./tool-usage) | 如何选择 read、grep、edit、write、bash？ |
| [Bash](./bash-thinking) | 命令输出太长、超时、子进程怎么处理？ |
| [Edit](./edit-thinking) | 为什么按文字片段改文件，不按行号改？ |
| [Grep](./grep-thinking) | 怎样高效搜索代码，不把仓库全读进来？ |
| [Write](./write-thinking) | 怎样安全地新建或覆盖文件？ |
| [工具操作展示](./operation-thinking) | 怎样让用户看清改了什么、跑了什么？ |
| [流式输出](./streaming) | 为什么要边生成边展示？ |
| [流式进度](./progress-thinking) | 为什么过程信息要短，工具信息要保留？ |
| [调用链](./calltrace-thinking) | 怎样回看完整执行过程？ |
| [沙箱](./sandbox-thinking) | 给命令画权限红线，和容器有什么不一样？ |

## 状态和体验

| 文档 | 主要回答的问题 |
|---|---|
| [项目状态](./project-thinking) | Agent 工作时需要知道哪些环境事实？ |
| [会话](./session-thinking) | 为什么会话切换要先快后全？ |
| [缓存](./cache) | 哪些结果能复用，哪些结果不能缓存？ |
| [模型前缀缓存](./prefix-cache-thinking) | KV 缓存在 provider，Agent 怎么去命中它？ |
| [Token](./token-thinking) | 用量为什么要复用同一份状态？ |
| [输入框](./input-thinking) | 怎样让用户更容易给 Agent 下清楚的指令？ |
| [悬浮面板](./floating-panel-thinking) | Git 和后台命令状态为什么要单独展示？ |

## 通用判断标准

- 先解决真实问题，再决定要不要增加抽象。
- 只要数据会影响后续决策，就不要只保存成展示文字。
- 能由程序保证的事情，不要只写在提示词里。
- 错误信息必须能帮助下一步行动。
- 任何自动重试都要有上限和停止原因。
- UI 可以压缩展示，但不能篡改事实。

