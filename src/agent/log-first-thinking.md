# Log-First：日志不是用来排障的，日志就是运行时

## 它解决什么问题

一次 Agent 运行，真正经历的状态空间远比"最后那段回答"复杂：模型第几轮开始、调了什么工具、工具返回什么、哪里等了权限、哪个 provider 流迟到、进程崩在哪一步。如果只把最终回答存下来，所有这些问题都只能靠猜。

普通应用的日志是"业务执行完后描述代码做过什么"，给人排障用。Agent 运行时不一样：**日志本身就是业务语义的一部分**——用户消息、模型回复、thinking、function call/response、权限动作、usage、终止状态，这些都是 Agent 交互的语义事实。删了这份日志，系统就失去重建交互状态的基础。

所以问题不是"要不要记日志"，而是：

> 把一次运行记录成一段可以重新解释和回放的事实历史，让下一轮模型、UI、恢复逻辑、调试器都成为这份历史的消费者，而不是各自保存一份局部真相。

## 核心判断：状态不是一张表，是日志的函数

最关键的设计判断：

> **Event Log 才是 Agent 交互的语义事实源。系统在某一时刻的状态，是这段有序日志经过某种投影之后的结果。**

写成关系：

```
State(t) = Project(RuntimeEvents[0..t], policy, runtime configuration)
```

同一份日志被不同消费者解释成不同状态：

- Model History Projector → 下一轮模型要看到的 messages
- UI Read Model → 对话、工具活动、Turn 状态
- Terminal Fact Classifier → 一次 Run 的最终结果
- Recovery → 进程退出前哪些事实已经 durable
- Compaction → 更小但保留关键语义的工作上下文
- 未来的调试器 → 把读取位置停在任意事件边界，观察当时的 Agent 状态空间

日志是稳定事实，其余都是可以演进、重建或替换的派生视图。这和数据库 WAL、event sourcing、Kafka 的直觉一致：**不要把每个下游视图都当独立真相，先保存有序、不可含糊的变化事实，再让消费者重建自己的状态**。

注意：这不是在进程内实现了 Kafka，也不需要分布式共识日志。借鉴的是更基础的原则——log is the source of truth, state is a materialized view。

## 一条 RuntimeEvent 保存了什么

不是 `role + text` 那么简单。一条事实被拆成几组正交信息：

| 维度 | 关键字段 | 意义 |
|---|---|---|
| Identity | sessionId / invocationId / runId / turnId / branch | 这条事实属于哪段会话、调用、执行尝试、分支 |
| Ordering | id / ts / ledger 顺序 | 在因果历史中的位置 |
| Source | role / author | 在模型历史中扮演什么角色，由谁产生 |
| Content | text / thinking / function call-response / error | AI 交互本身的语义内容 |
| Actions | state delta / permission / artifact / usage / end invocation | 要求 Runtime 怎样改变控制状态或记录副作用 |
| Correlation | tool call / provider event / step / artifact refs | 怎么把跨系统的同一件事重新配对 |
| Lifecycle | partial / status | 是可替换的流式片段，还是持久事实或终止事实 |

保留的不是 UI 已经格式化好的聊天文本，而是模型交互的原始语义。所以模型历史不需要从 UI transcript 反向解析——它从日志里选 non-partial、model-visible 的事件，保持顺序，再按 provider 能力物化成 text-only 或 provider-native messages。UI 也只是另一种 projection，不是事实源。

## 三个不要混在一起的身份

| 概念 | 回答的问题 |
|---|---|
| Session | 这些对话和运行属于哪段长期交互？ |
| Turn | 用户界面中的这一轮问答是哪一轮？ |
| Run | 这一次具体执行尝试是谁？状态是什么？ |
| Invocation | 一次 Flow 调用从开始到终止的标准边界是什么？ |

最重要的判断：**Turn 不是 Run，聊天消息也不是执行状态**。一个用户可见的回合需要一个系统可追踪的执行封套；否则系统只能知道"出现过一些消息"，却无法可靠回答"这次执行是否真正结束"。

## 回放有三个层次，不是都能拍胸脯

"可以回放"最容易被简化成"能回放一切"，其实要分层：

| 层 | 含义 | 难点 |
|---|---|---|
| 1. 语义回放 | 给定 ledger，重建用户/模型文本、thinking、工具调用与结果、权限动作、usage、terminal fact | 当前已成立 |
| 2. Provider-native 回放 | 不是把 JSONL 原样塞给任何模型，先建 replay plan：检查 partial、tool call/result 配对、step ID、thinking signature、provider 支持，再决定 provider-native / text-only / 显式降级 | 有能力门控 |
| 3. Bit-exact wire replay | 完整快照每次 provider HTTP 请求的原始字节 | **当前不承诺** |

第三层做不到的原因：system prompt、工具 schema、provider options、模型实现版本、context selection/compaction policy 仍参与最终 request 生成；当前系统记录了其中一些 identity、diagnostic 和 hash，但没有把整个 wire request 复制进 ledger。

这不是削弱日志的价值，反而说明它提供了正确的基础：**message facts 保持稳定，request materialization 可以独立演进**。如果未来要承诺 bit-exact replay，需要对运行配置、prompt、tool catalog、投影策略、provider request shape 做版本化或快照化。

## "全量记录"的两个重要例外

### 例外 1：流式 partial 不无限追加进不可改账本

流式 text/thinking 的 partial chunk 不会一条条追加进不可改 JSONL，而是维护**有界的 partial snapshot**，最终 non-partial 事件到达后覆盖它的语义位置。

这是故意的：既保留崩溃时已经展示的部分输出，又避免"10,000 个 delta 变成 10,000 条长期账本记录"。`partial: true` 的是 transient chunk，模型历史重放必须排除它们。

所以严格说，不可改账本里存的是**稳定的最终语义事实**，不是每一次流式 token。partial 是可替换的投影状态，不是 immutable fact。

### 例外 2：不 bit-exact 快照 provider HTTP wire request

见上面第三层回放。

所以"全量"是**交互语义全量**，不是"每一次网络请求字节全量"。

## Log-first 的关键不变量：先有终止事实，再提交终止状态

Runtime 最容易出现的一类故障，是不同存储对"是否结束"给出不同答案：

- run header 写成 completed，但 ledger 没有 terminal event；
- 用户已经 stop，但迟到的 complete 又把 Session 写回 active；
- Backend 流耗尽，却从未说明它是成功还是失败；
- terminal event 已写入，但进程在更新 Run header 前崩溃。

保护的核心不变量：

> 一个终止的 Run 必须有且只有一个有效 terminal RuntimeEvent；终止的 Run header 必须能够由这个 terminal fact 支撑。

因此 `AgentRun` 在提交 terminal header **之前**，先要求 terminal RuntimeEvent 成功落盘。后果：

- 没有终态的 Flow → 合成成 `missing_terminal_event` 失败；
- 重复终态 → Flow 合并；
- 状态不匹配 / 来自别的 Run / 标记为 partial 的 terminal → 拒绝；
- header 声称已结束但没有可信 terminal fact → 不信 header，保守修复为失败；
- header 还是 running 但 terminal event 已存在 → 把 terminal event 当更强事实，恢复时修 header。

这条不变量让恢复**不必猜模型当时想干什么**，只需要判断哪些事实已经 durable，再把各投影收敛到同一个可解释终态。

## Stop / 错误 / 崩溃怎么收敛

这是回放设计的另一面。

- **用户停止**：先把所有活跃 AgentRun 标 stopped，再调 backend stop()。迟到的 complete 不能覆盖已确定的 aborted 语义。
- **Provider/Runtime 错误**：先规范成非终止 error content，再由 failed terminal event 关闭；之后的 completed 不能掩盖已观察到的错误。
- **应用崩溃 / 启动恢复**：**不重新执行**模型请求或工具副作用，只扫描 stale stream / tool tail / permission wait / 损坏 operational event，保守提交失败或取消，修 Session/Turn 投影。这是"状态修复"，不是 checkpoint resume。

> 注意一个当前边界：当前 Runtime 是"确定性终结与修复"，**不是任意位置 warm resume**。它能保留部分输出、恢复一致的终态、为以后真正的中点恢复打事实基础，但不会在进程重启后自动从某个工具调用的下一行继续。

## 一份语义事实，两类辅助状态

不要把所有持久数据都当同等的"真相"：

| 存储 | 主要内容 | 它回答的问题 |
|---|---|---|
| RuntimeEventStore | canonical `runtime-events.jsonl` + 有界 partial snapshot | Agent 交互发生过哪些语义事实，其他状态应如何重建？ |
| SessionStore | 用户/assistant/工具/turn-state 等 StoredMessage | UI 与兼容接口要展示什么？活跃流有哪些即时投影？ |
| AgentRunStore | run.json + operational events.jsonl | 这次 Run 何时开始、当前状态、在哪个阶段失败？ |

RuntimeEventStore 是 canonical semantic log；另外两类是产品投影与运维状态。已完成且 ledger 完整的 Run，读取和下一轮 replay **优先依赖 RuntimeEvent**，SessionStore 不能简单删除但不再是 completed runtime 语义的唯一权威。

## 几家怎么做（同一谱系，不同程度）

把 maka、Codex、Claude Code、pi 放一起，"日志是不是状态"是个谱，不是开关：

| | maka | Codex | Claude Code | pi |
|---|---|---|---|---|
| 日志地位 | canonical 事实源，状态是投影 | 持久化源，resume/fork 靠它重建 | 持久化载体，transcript≈状态 | 会话树本体就是状态 |
| 主存储 | runtime-events.jsonl + 有界 partial | rollout-*.jsonl + zst 压缩 | session .jsonl + sidechain .jsonl | sessions/*.jsonl（树形 id/parentId） |
| 辅助存储 | SessionStore/AgentRunStore（投影） | SQLite 索引（发现/元数据） | history.jsonl、file-history 检查点 | 无 |
| 流式 partial | 不进不可改账本，有界 snapshot 覆盖 | 直接 append（带 ordinal） | 直接 append delta | 直接 append 节点 |
| 语义回放 | ✅ | ✅ reconstruct_history_from_rollout | ✅ resume 重放 transcript | ✅ 加载树走 active leaf |
| 终态不变量 | 强（terminal fact 先于 header） | 中 | 弱（靠 compact_boundary UUID 链） | 无 |
| resume 恢复权限 | 恢复元数据但不重授权限 | 恢复 TurnContext 策略 | **故意不恢复**（怕陈旧信任带入新上下文） | 无内置权限 |

三种"log-first"程度：

- **maka 最彻底**：State = Project(events, policy, config)。SessionStore/AgentRunStore 删了能重建。特色是 terminal invariant——Run header 不能自己宣布完成，必须有 terminal fact 支撑，且 fact 先于 header 落盘。
- **Codex 是 rollout-first**：rollout JSONL 是 resume/fork 的唯一依据，`reconstruct_history_from_rollout` 反向找最新 `Compacted`/`WorldState` 基线再正向重放。没有 maka 那种 fact vs projection 分层——rollout 既是事实又是状态本身。额外有 rollout-trace：observe-first-interpret-later 的诊断包，热路径只写 raw event，离线 reducer 才归约成语义图。
- **Claude Code 是 append-only transcript**：transcript 就是状态，没有独立 canonical ledger。特色是 compact_boundary 的 UUID 链（headUuid/anchorUuid/tailUuid），loader 读时按边界元数据 patch 消息链。resume 故意不恢复权限——"重新授予优于隐式持久化信任"。
- **pi 是会话树**：每个 entry 带 id/parentId 形成树，分支就在原地（/tree 跳到任意历史点继续，不新建文件）。四家里唯一结构性支持探索分支的。不区分 fact/projection，会话文件就是状态。

## 为什么不做一个"会自己猜状态的超级 Runtime"

最诱人的设计是：Runtime 自己维护一张"当前状态表"，每次更新直接改表，日志只当旁路记录。听起来比"状态是日志的投影"简单多了。

但它会在三个地方塌：

- **一致性**：状态表和日志会分叉。崩溃后，表说 completed 但日志没 terminal event，到底信谁？log-first 用 terminal invariant 一句话解决（信 fact，修 header）。
- **可重建**：状态表坏了就得全量重算。日志坏了系统也没了。log-first 让投影能从日志重建，状态表不能反过来重建日志。
- **多消费者**：UI 要一种视图、模型历史要另一种、恢复要第三种。一张状态表满足不了所有消费者，要么强行塞进一张宽表，要么每家自己维护一份局部真相。log-first 让每家做自己的 projection，共享同一份 fact。

所以这个设计选的是**事实单一源 + 投影多消费者**，不是"一张表管全部"。

## 经验

- 核心判断：日志不是排障用的，日志就是运行时；状态是日志的投影，不是一张独立的表。
- 一条事件存的不只是 `role + text`，要拆成 Identity / Ordering / Source / Content / Actions / Correlation / Lifecycle 七组正交维度。
- Turn 不是 Run，聊天消息不是执行状态；用户可见回合需要系统可追踪的执行封套。
- 回放分三层：语义回放（已成立）、provider-native（门控）、bit-exact wire（不承诺）。别把"可回放"简化成"能回放一切"。
- "全量"是交互语义全量，不是字节全量：流式 partial 用有界 snapshot 覆盖不进不可改账本，provider wire request 不字节快照。
- 关键不变量：先有终止事实，再提交终止状态；header 不能自己宣布完成，必须有且只有一个 terminal fact 支撑。
- Stop/错误/崩溃靠事实收敛状态，不重新执行副作用；当前是确定性终结与修复，不是任意位置 warm resume。
- 一份语义事实 + 两类辅助状态（产品投影 + 运维索引）；completed Run 的读取和下一轮 replay 优先依赖 canonical log。
- 不做"自己猜状态的超级 Runtime"——一致性、可重建、多消费者三方面都会塌；选事实单一源 + 投影多消费者。
- 不同系统 log-first 程度不同：maka 最彻底（terminal invariant）、Codex 中（rollout 重放）、Claude Code 偏弱（transcript 即状态）、pi 是会话树。按需求选位置，别假装只有一种正确答案。