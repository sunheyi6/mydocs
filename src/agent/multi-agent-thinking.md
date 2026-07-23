# 多 Agent 协作：子 Agent 产证据，父 Agent 拥有完成判定

## 它解决什么问题

一个 Agent 干所有事，会撞到几道墙：

- 任务里有"读本地代码"和"联网搜索"两类完全不同的工具集，全开给一个 Agent，权限面太大、上下文也乱。
- 一批独立的子任务串行跑太慢，天然想并行。
- 不同子任务需要不同"人格"（只读侦察、写代码、查资料），但谁都不该越权。

最朴素的解法是"派子 Agent"：父 Agent 把一块活交给一个有界、隔离的子 Agent，等它返回结果，再综合。但子 Agent 一旦能跑，立刻会冒出一堆新问题：子 Agent 能不能自己说"我做完了"？子 Agent 的权限能不能比父 Agent 高？一个子 Agent 跑挂了整批怎么办？子 Agent 之间能不能串通？

多 Agent 协作真正难的不是"怎么一起跑"，而是**怎么让协作不破坏 authority 链**。

## 一条核心边界：Feedback 不是 Authority

整个设计最用力守护的一条线：

> **子 Agent 只能产证据，不能产信任。**

- 父 Agent（或 lead）始终是任务完成的判定者。Swarm、expert_dispatch 的提示词里都写死一句："you remain responsible for synthesis and final task completion"。
- 在评测/长程任务场景里更彻底：完成判定交给 Task 上声明的**外部 verifier**（跑命令、跑测试），评分前还会从干净的 fixture 恢复 `protectedPaths`——agent 不能改自己的评分脚本给自己放水。
- 自检（self-check）因此被压成"有计划、有公开证据、修复次数受限"的 advisory loop，**不是第二个 Agent loop**。Self-check can produce evidence and feedback; it cannot manufacture trust.

这条边界的难点不在技术，而在克制。很容易手痒给子 Agent 加一句"你检查一下自己，没问题就结束"。一旦子 Agent 能用自己的自述关闭任务，整条 authority 链就塌了：没有人再为"事情到底做完没有"负责。

## 三种协作形态，按强度分

不要用一个"通用 Orchestrator"调度任意 Agent。按协作强度分三条路径，全建立在同一个执行核心上：

| 形态 | 工具 | 场景 | 父 Agent 干什么 |
|---|---|---|---|
| 单个子 Agent | `agent_spawn` | 一块有界的活交给一个 profile | 写好 task，等结果，综合 |
| 并行扇出 | `agent_swarm` | 多个**独立** item 同时跑 | 一个 step 只调一次 swarm，整批 settle 后再去重/综合 |
| 专家团队 | `expert_dispatch` | 一个 lead + N 个 member | lead 派发、收 digest、做最终综合；member 可互发有界消息、可认领共享任务 |

关键约束是**综合责任永远在父/lead**。Swarm 的结果是按输入顺序返回的每个 item 的 digest，不是自动合并好的答案；父 Agent 必须自己做"验证、去重、语义综合"。

## 子 Agent 的身份是"契约"，不是自由编排

子 Agent 不是临时拼出来的，而是从一个固定的 catalog 里挑 profile。每个 profile 带着强类型契约：

| Profile | 工具 | 权限 | 工作区 | 写回 |
|---|---|---|---|---|
| local_read | Read/Glob/Grep | explore | 同一工作区 | summary |
| web_research | WebSearch | execute | 同一工作区 | summary |
| implementation | Read/Glob/Grep/Write/Edit/Bash | execute | worktree | patch |

契约里写死了 `capability / invocation / context / workspace / defaultWriteBack / supportedWriteBack`。spawn 的入参在 schema 层用 `superRefine` 强制校验：`write_back` 和 `isolation` 必须落在该 profile 支持范围内，越权直接报错。

这带来的好处是**可静态推断**：给定一个 profile id，不需要运行时状态就能知道它能用什么工具、什么权限、写回什么形态。坏处是不灵活——要新能力就得新 profile，不能让一个子 Agent 临时"借"个工具。

## 几条硬边界，守住才不失控

### 1. 权限天花板：子不能高过父

子 Agent 的 `permissionMode` 来自 profile，但被父 session 的权限上限夹住（`permissionCeiling = parent.permissionMode`）。一个 explore 模式的父 Agent **派不出** execute 的 implementation 子 Agent——会在 spawn 前被拒。

否则就出现"我用低权限模式，但我派个高权限子 Agent 替我干活"的绕权通道。

### 2. 工具只能收窄，不能放宽

Expert team 的不变量：member 声明一个 archetype（某个 built-in profile），只能从 archetype 工具集里取**子集**，widening 在物化时被拒。协作不能变成能力扩散——一个只读侦察 member 不能顺手带上 Write。

### 3. 隔离不可用就 fail-closed，绝不静默降级

`implementation` profile 需要 worktree 隔离，但运行时还没接 worktree executor，所以现在**直接抛错**：profile requires worktree isolation, but this runtime does not provide a worktree child executor yet。

这是故意的。不能为了让它能跑，偷偷把隔离降级成 same_workspace——那会破坏"写操作的子 Agent 必须在隔离工作区"这条安全假设。**fail-closed 是特性，不是 bug**。沙箱/隔离类设计都遵循同一条：降级能跑就跑是普通功能的作风，安全边界降级等于没有边界。

### 4. 上下文隔离是特性，不是缺陷

子 Agent 拿到的是 fresh context，只看到父 Agent 传入的 `task` 字符串，看不到父 Agent 的历史。代价是**写 task 的负担完全压在父 Agent 身上**：scope、期望输出、约束，都得在 task 里说清楚，子 Agent 不会去猜上下文。

这是协作质量最容易掉链子的地方，而且运行时管不了——只能靠 prompt 提示。父 Agent 经常偷懒写一句"看看这个模块有什么问题"就 spawn，子 Agent 几乎一定跑偏或返空。

## 几个真正困难的工程点

### 部分失败的收敛

Swarm 一次 batch 可能：有的 completed、有的 RateLimit、有的 Timeout、有的 ParentCancelled。用 `failureClass` 分类 + 聚合成 `completed / partial / cancelled`。

难的是 **partial 的语义**：父 Agent 拿到 partial 后该不该重试失败的几个？现在靠 `resume_run_ids` 让父 Agent **显式**续跑已终止的子 run，而不是 runtime 自动重试。这是有意的边界——runtime 不替你决定"要不要继续"，决策权交回父 Agent。

### 并发容量是双层的，容易混淆

工具调用准入是一层；spawn 能力层的真实运行预算是另一层（`ChildAgentRunLimiter`，所有 caller 共享同一个 budget）。一个被准入的 swarm 工具调用可能 fan-out 最多 32 个 item，但实际同时跑的受运行预算和 swarm 的 `max_concurrency`（≤5）双重限制。

别假设"我调了 swarm 它就真的并行跑了 32 个"——大部分会 `item_queued` 排队。调试时看到"好像没干活"，先确认是不是被进度投影截断了，而不是真的没动（进度投影默认有界快照：64 事件 / 8KB）。

### Resume 是续跑同一件事，不是复用身份干新活

`resumeChildAgent` 会重新校验 `sourceRunId / agentId / agentName / profile` 完全一致才续跑；spawn 还有 `requestFingerprint` 防止"同一 spawn key 被复用做不同的工作"。

这意味着不能拿一个子 run 的 runId 去续跑另一件事——会直接报错。Resume 是"继续同一件未完成的事"，不是"复用一个子 Agent 干新活"。

### Mailbox 是"瘦"协作，不是"富"协作

Team 成员之间只能交换**有界的 digest**（内容有大小上限、列表有条数上限），不能传文件、不能传大段代码。

这是为了防止 member 之间形成隐式的"第二条上下文通道"，绕过父 Agent 的综合责任。如果发现协作里需要传大上下文，那说明任务没拆对——应该合并回 lead，或拆成独立子 run。

## 容易被忽视、但很关键的注意点

1. **Task 绑定用了就一定要结算**。spawn 传了 `task_id` 后，无论成功/失败/取消，都会自动 settle 到 ledger。但这是**工具层的责任**，不是 runtime 层的。绕过 `agent_spawn` 直接调底层 `spawnChildAgent` 能力，ledger 不会被自动结算。

2. **父取消是级联的，但不是瞬时的，更不回滚**。父 Agent 取消后子 run 会被标 stopped，但子 Agent 已经执行的 in-flight 工具副作用（比如已经跑完的 shell 命令）不会被撤销。Runtime 是"事实不可改写"模型，停止只收敛状态，不回滚已发生副作用。

3. **每次 spawn 都过权限确认**。spawn/swarm/expert_dispatch 都是 `permissionRequired: true`。不要为了"流畅"在客户端预判该不该 spawn——客户端不做决策，安全靠执行层确认弹窗。预判只会让人盲点同意。

4. **多套事件并存时的投影一致性**。架构里同时存在 SessionEvent / StoredMessage / RuntimeEvent / operational Run events 四套事件。在子 Agent 链路上加新事件类型时，要同时考虑这四套投影，否则会出现"UI 看到了但 log 没记"或反过来的不一致。

## 为什么不做一个"会自己调度的超级 Agent"

最诱人的设计是：给一个 Agent 一个"派子 Agent"的通用工具，让它自己决定怎么拆、怎么并行、怎么收。听起来比固定 profile 强多了。

但它会在三个地方塌：

- **权限**：通用派发 = 通用越权入口。固定 profile 让权限是静态可推断的，通用派发让权限变成运行时动态计算，审计面爆炸。
- **综合**：让子 Agent 互相调用、互相综合，最终"谁负责完成"会糊掉。固定模型是"父 Agent 永远负责"，简单但可靠。
- **终止**：让 Agent 自己决定要不要再拆一层，很容易无限递归或循环。Self-check 已经是"第二个 loop"的风险点了，再加自由派发就是第三个。

所以这个项目选的是**受限但可审计**的协作原语，不是灵活但失控的通用编排。

## 几家怎么做（四个流派）

把 maka、Claude Code、Codex、pi 放一起，多 Agent 是分歧最大的一块，四家几乎是三个流派。

| | maka | Claude Code | Codex | pi |
|---|---|---|---|---|
| 是否有子 Agent | 有，三档 | 有，一档但极丰富 | 有，multi_agent_v2 | **明确不做** |
| 派发原语 | agent_spawn / agent_swarm / expert_dispatch | Task/Agent 工具 | spawn_agent 等 | 无（让你用 tmux 起 pi 实例或写 extension） |
| 子 Agent 定义来源 | 固定 catalog + expert team 数据驱动 | 内置 6 个 + .claude/agents/*.md frontmatter + 插件 + 策略 | ThreadManager 管 CodexThread，AgentControl 派发 | — |
| 并行 | swarm（并发 3/上限 5/最多 32 item，自适应 RateLimit 重试） | 多个 Task 并发 + agent teams + 后台默认 | 多线程 + 父子线程共享一个 trace writer | 多 pi 实例（用户自己组） |
| 隔离 | worktree（目前 fail-closed 跑不了）/ same_workspace | worktree / remote / in-process | 线程级 + 沙箱 | — |
| 上下文 | fresh（只看父传的 task） | fresh（非 fork）；**fork 继承父全部历史**为命中 prompt cache | 子线程独立历史 | — |
| 父子通信 | 有界 mailbox + task ledger claim/settle | SendMessage + 任务工具 | InterAgentCommunication rollout item | — |
| 完成判定 authority | **父 + 外部 verifier**（protectedPaths 防作弊） | 父（Verification subagent 只是只读对抗性检查，父仍拍板） | Guardian review（运行时内） | 单 Agent 自决 |
| 权限天花板 | 子 ≤ 父，工具只收窄 | 子继承父权限，父若 bypass/acceptEdits/auto 优先 | TurnContext 带 approval/sandbox policy | 无内置权限 |
| 嵌套 | 不允许 | 可配 depth（默认 0，曾默认 5） | 子线程可再派 | — |
| 限额 | ChildAgentRunLimiter 共享预算 + swarm 并发 | 每会话 200 个 + 并发 20 | 线程级 | — |
| 子输出安全 | 无特殊扫描 | **subagent output scanning** 防 prompt injection 回流 | rollout-trace 离线分析 | — |

### 四个流派的哲学

**maka：受限但可审计的原语**。固定 profile 契约（工具/权限/工作区/write-back 全静态可推断），权限天花板，工具只收窄，worktree 不可用就 fail-closed，mailbox 是瘦协作，综合责任永远在父。最独特的是把 headless 外部 verifier 作为最终 authority——子 Agent 自检只是 feedback，不能 manufacture trust。

**Claude Code：功能最全、最工程化**。四家里最复杂：fork 子 agent（继承父全部上下文为 byte-identical prompt prefix，命中缓存省 90%）、后台默认、agent teams、嵌套可配、output scanning 防 injection、15 步 runAgent 生命周期、Feature flag + GrowthBook 实验门控。核心权衡是经济性：Explore agent 一周跑 3400 万次，每个省 135 字符 = 一周省 46 亿字符。没有 maka 那种外部 verifier 设计，Verification subagent 也只是只读对抗性检查，父仍拍板。

**Codex：线程树 + rollout-trace**。multi_agent_v2 把父子线程写进同一份 rollout tree，共享一个 trace writer，一个 root bundle 归约成一张图（含 InteractionEdge：spawn/task/result/close）。特色是 observe-first-interpret-later：热路径只写 raw event，离线 reducer 决定哪些成为 model-visible conversation、哪些是 runtime work。和 maka 一样有线程谱系（thread_spawn_edges），但更像"记录 + 离线分析"，而 maka 是"事实 + 实时投影"。

**pi：明确不做**。README Philosophy 段写得很直白：

> **No sub-agents.** There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions, or install a package that does it your way.

pi 的哲学是核心最小化，功能靠 extension/skill/package 拼出来。同样被明确"不做"的还有 MCP、内置权限弹窗、plan mode、内置 todo、后台 bash。所以 pi 的多 Agent 是用户自己在 tmux 里起多个 pi 实例，运行时不提供任何编排、隔离、mailbox、权限边界。这是和前三家完全相反的取向——前三家都把多 Agent 当核心能力往里堆，pi 把它整个推给生态。

### 一张总表：设计空间里的位置

| 维度 | maka | Codex | Claude Code | pi |
|---|---|---|---|---|
| 多 Agent | 受限原语（三档） | 线程树 + 离线 trace | 最全（fork/swarm/teams/nesting） | 无 |
| 隔离手段 | worktree（fail-closed） | 线程 + 沙箱 | worktree/remote/in-process | 容器（外部） |
| 完成判定 | 父 + 外部 verifier | Guardian review | 父 Agent | 单 Agent 自决 |
| 扩展哲学 | 固定 profile + expert team | 协议 + 插件 | .claude/agents + 插件 + GrowthBook 实验 | extension/skill/package，核心最小 |

### 几条可迁移的判断

把四家放一起能看出几条不是某家独有、而是设计空间里的通用权衡：

1. **"权限不能向上扩散"是共识**。maka 的 permission ceiling、Claude Code 的父优先模式、Codex 的 TurnContext 带策略都守这条。区别在守多严：maka 用固定 profile + fail-closed 最硬，Claude Code 留了 fork 继承和可配嵌套的口子。

2. **"子 Agent 只产 digest，不回流原始上下文"也是共识**。maka 的 summary/patch write-back、Claude Code 的 summary-only return、Codex 的 result message都是。但 Claude Code 额外做了 output scanning 防 prompt injection 从子回流——maka 和 Codex 都没有（maka 靠权限隔离 + 父拍板兜，Codex 靠离线 trace 分析兜）。

3. **完成判定要不要外部 authority 是最大分水岭**。maka 在 headless 用外部 verifier + protectedPaths（agent 不能改评分）；Claude Code 的 Verification 仍是父的工具；Codex 的 Guardian 是运行时内 review；pi 完全没这层。这条线决定了"自检是不是自信任"——maka 明确不是，其他三家默认是。

4. **"不做"也是一种设计**。pi 的 No sub-agents 不是偷懒，是另一种取向：把编排、协议、安全全部外推到 extension/package 生态，核心只做最小循环 + 会话树。代价是多 Agent 协作要用户自己组，好处是核心极小、可替换、可组合。

一句话收束：**maka 和 Codex 是"重事实/重审计"一系，Claude Code 是"重工程/重经济"一系，pi 是"重最小/重可组合"一系**。前三家都把多 Agent 当核心能力往里加，pi 把它整个推给生态——这是哲学选择，不是能力缺失。

## 经验

- 核心边界：子 Agent 产证据，父 Agent 拥有完成判定；自检是 feedback，不是 authority。
- 协作按强度分三档：单个 spawn、并行 swarm、专家团队；综合责任永远在父/lead。
- 子 Agent 身份是固定 profile 契约（工具/权限/工作区/写回），不是自由编排。
- 权限天花板：子不能高过父；工具只能收窄不能放宽。
- 隔离不可用时 fail-closed，绝不静默降级——安全边界降级等于没有边界。
- 上下文隔离是特性：写 task 的负担在父 Agent，运行时管不了，只能靠提示。
- 部分失败不自动重试，把"要不要续跑"的决策权交回父 Agent。
- 并发容量是双层的（工具准入 + spawn 预算），别假设调了就真并行。
- Resume 是续跑同一件事，不是复用身份干新活。
- Mailbox 是瘦协作（有界 digest），别让它变成绕过综合的第二上下文。
- Task 绑定/取消/事件投影这些"边界上的事"最容易踩坑，且常常是工具层责任而非 runtime 层。
- 不要做"会自己调度的超级 Agent"——受限但可审计的原语比灵活但失控的编排可靠。
- "权限不能向上扩散"是四家共识；区别只在守多严，maka 最硬（固定 profile + fail-closed），Claude Code 留了 fork 继承和嵌套口子。
- "子 Agent 只产 digest 不回流原始上下文"是共识；但防 prompt injection 回流只有 Claude Code 做了 output scanning。
- 完成判定要不要外部 authority 是最大分水岭：maka 用外部 verifier（agent 不能改评分），其他三家默认父/运行时拍板——这决定自检是不是自信任。
- 四家流派：maka/Codex 重事实审计，Claude Code 重工程经济，pi 重最小可组合。pi 明确不做子 Agent 不是能力缺失，是把编排/协议/安全全推给生态的哲学选择。