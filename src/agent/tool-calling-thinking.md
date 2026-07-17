# 工具调用：模型想做什么，程序负责安全执行

## 它解决什么问题

模型只能生成文字，不能自己读磁盘、改文件和跑测试。工具调用把模型的动作请求交给程序执行，再把结果放回上下文。

基本循环是：

`模型决定动作 → 校验参数 → 权限判断 → 执行工具 → 返回结果 → 模型决定下一步`

好的工具调用设计，不只回答“怎么调 API”，还要回答：

- 这次调用什么时候算**最终完成**；
- 结果要不要**剪裁**、剪到哪一层；
- 结果如何**进入模型上下文**；
- 结构化字段如何既服务 UI，又服务模型，还经得起压缩。

## 三条通道不要混成一份 blob

工具结果在系统里至少有三条通道，职责不同，剪裁策略也不同：

| 通道 | 职责 | 能否随便裁 |
|------|------|------------|
| UI / 会话展示 | 用户看过程、diff、终端卡片 | 可投影、可截断显示，但应能展开或回看 |
| 持久化 / 审计 | 回放、诊断、artifact | 尽量全量或可归档，不要 silently 丢 |
| 模型上下文 | 下一轮决策依据 | **必须有界**，是剪裁主战场 |

如果只维护一份“又给 UI、又给模型、又当历史”的大字符串，剪裁会互相打架。正确做法是：

- 运行时保留完整语义结构；
- UI 读结构化字段；
- 模型只看有界投影；
- 过大原文归档或落盘，上下文里留指针。

## 工具接口要统一

每个工具都需要：

- 名称、说明、参数 Schema；
- 执行函数；
- 统一结果信封；
- 是否只读 / 权限类别（决定能否自动执行、能否流式预执行）。

结果信封至少包括：

- 调用 ID（与模型的 tool call 对齐）；
- 工具名；
- 成功 / 失败 / 中止；
- 给模型看的有界输出。

给 UI 的文件统计、命令退出码、PID、diff 摘要等，放在结构化 `details` 或按 kind 的载荷里，**不要让 UI 从一段人类可读文本猜状态**。

## 如何区分“工具最终完成”

这里必须拆三层，不能混用：

| 层次 | 含义 |
|------|------|
| A. 工具调用终态 | 这次 tool call 的 Promise 已 settle，可以写回模型 |
| B. 语义成功 / 失败 | 退出码、文件是否写上、是否超时 |
| C. 后台副作用生命周期 | 进程 / 服务是否还在跑（可与 A 不同步） |

### 调用终态（A）

权威信号是**结果事件**，不是进度事件：

- 开始：`tool_start` / `tool_started`
- 过程：`tool_progress` / `tool_output_delta`（**永远不是完成**）
- 结束：`tool_end` / `tool_completed` / `tool_result`

所有出口都要落到结束事件：成功、失败、超时、未知工具、参数校验失败、用户取消、权限拒绝。没有结果的调用，模型无法继续。

UI 状态机：

`pending / running → done | error | aborted`

判定规则：

- 还在跑：已 start，未收到 end/result；
- 调用完成：收到配对的 end/result（按 `toolCallId` / `toolUseId`）；
- 过程输出只更新 `partialOutput`，不改终态。

### 语义成败（B）

不要只靠“有没有返回”。要用明确字段：

- 扁平方案：`success: boolean` + 可选 `error`
- 更稳的方案：`status: success | error | aborted`，再由结构化内容细判

例如终端类：

- `exitCode === 0` 且 status completed → 成功
- 非 0 / timed_out / failed → 失败
- cancelled → 中止

文件类、搜索类、子代理类各自用 kind 内字段表达，**统一在一处映射到 isError / success**，供 telemetry、loop-gate 和 UI 共用。

### 后台进程（C）

后台 bash 是特例：**工具调用可以结束，进程还在跑**。

- 前台命令：工具完成 ≈ 进程完成
- 后台 / service：工具返回的是观察结果（pid、ref、startup marker、端口可达），进程状态另管

因此：

- 工具完成看 end/result 事件；
- 服务是否起来了看 `BackgroundProcess` / `shell_run.status` / 端口 / marker；
- 模型侧要有明确 status，例如 `command_completed | command_failed | service_observation`

## 执行时要防什么

- JSON 解析失败不能让循环崩溃，返回可行动错误。
- 必填参数缺失时不要执行。
- 常见类型错误可以有限转换（如字符串数字 → integer），但不能任意猜。
- 同一文件的 write/edit 要串行。
- 未知工具、超时、异常都要变成 tool result，不能静默吞掉。
- 同一 tool + 相同参数连续失败多次时，应 loop-gate / 断路，避免无进展空转。
- 写工具在确认模式或 plan 模式下不得绕过权限。

## 权限与只读

至少区分只读与变更：

- 只读：read / grep / glob / ls / web fetch 等，可自动执行，也可在流式阶段预执行；
- 变更：write / edit / bash 等，受权限模式约束。

更完整的系统会用类别矩阵（read / file_write / shell / network / computer_use / subagent），而不是一个布尔值打天下。但最小可用版本也必须有 `isReadonly` 或等价物，否则无法做安全预执行和确认策略。

## 结果要不要剪裁

要剪，而且要分层。

### 第一层：执行时 bound（防爆）

工具刚返回时就限制体量，避免一次 bash 打爆上下文。

| 输出类型 | 建议 |
|----------|------|
| 日志 / 编译 / 测试 | **tail** 保留末尾（错误常在最后） |
| 文件头 / 列表 / 搜索 | **head** 或摘要 + 指针 |
| 默认预算 | 约 2000 行或 50KB 量级 |

必须告诉模型：

- 裁了没有；
- 裁了多少；
- 怎么拿回剩余（`fullOutputPath`、artifact、redirect 后再 Read/Grep）。

不要鼓励对有副作用的命令盲目重跑。

### 第二层：上下文预算（保窗口）

历史里过大的 tool result 不能原样一直带着走。常见升级路径：

1. **Snip**：老且大、短期内不太可能再引用 → 短占位；
2. **Stale prune**：超过单结果 token 上限（如 2048）→ archive placeholder；
3. **Collapse / turn cap**：工具密集旧轮次投影成摘要或按预算丢弃旧迭代；
4. **History / semantic compact**：高水位时做摘要（更贵，最后手段）。

保护规则：

- 最近 1～N 个 turn 的 tool result 尽量完整；
- 当前 step 刚产出、下一请求立刻要用的，只做执行时上限，不做 stale prune；
- **成败元数据永不裁**：exitCode、error、path、status、ref、pid；
- 可裁的是 body / stdout / diff 正文。

### 第三层：同 turn 下一 step 前（可选，进阶）

多 step 工具循环里，本 turn 前几步产出的超大结果，可以在下一 step 前改写成 provider-visible 占位，并把原文归档。注意：

- 改的是**模型可见投影**，最好不要 silently 毁掉可回放的持久化原文；
- 占位必须可识别，避免二次 prune。

## 结果如何加入上下文

硬规则：

1. **顺序**：先 assistant（含 tool_calls），再按调用顺序写 tool results。
2. **配对**：每个 tool call id 恰好一个 result；失败也要 result。
3. **角色正确**：使用 tool / toolResult 语义，不要把结果伪装成普通 user 文本。
4. **投影分离**：UI 读结构；模型读有界投影。
5. **剪裁后仍可行动**：占位符要带 toolCallId、toolName、尺寸/hash、恢复路径，不能只剩 `[truncated]`。

推荐流水线：

```
Tool.impl 返回结构化结果 B
  → 执行时 bound，得到有界视图 + truncation 元数据
  → 投影 C = projectForModel(B)
  → 写入上下文：assistant(tool_calls) + tool(toolCallId, C)
  →（可选）同 turn 下一 step 前 active prune
  → 跨 turn：snip → stale prune → turn cap → compact
```

失败结果可以追加“可行动提示”（例如匹配到的历史教训），但提示应短，且不要污染成功路径。

## 结构化字段应该如何设计

### 三层字段模型

```
A. Call envelope     调用信封（所有工具共用）
B. Semantic payload  按 kind 的语义载荷
C. Context projection 仅模型可见的有界投影
```

- **A**：完成判定、UI 状态机、调用配对
- **B**：业务语义、卡片渲染、telemetry
- **C**：真正塞进 provider 的内容（可从 B 投影并剪裁）

### A. 信封（强制）

| 字段 | 说明 |
|------|------|
| `toolCallId` | 与 call 对齐 |
| `toolName` | 展示与诊断 |
| `success` / `isError` 或 `status` | 统一一套成败语义，不要混用两套 |
| `durationMs?` | telemetry |

建议对内用 `status: success | error | aborted`，对外再投影成 `isError`。

### B. 按 kind 的最小充分集

| kind | 必带 | 高价值可选 | 模型侧剪裁 |
|------|------|------------|------------|
| terminal | cmd, cwd, status, exitCode? | failureMessage, 有界 stdout/stderr | tail；status/exitCode 不裁 |
| shell_run / background | ref 或 pid, status, cmd, cwd | revision, ports, marker | 元数据全留；大日志不进历史 |
| file_read | path, 行范围 | truncated, totalLines | 按窗口；过大改占位再 Read |
| file_edit / write | path, ok | diff 摘要, added/removed | diff 超限只留路径+行数 |
| search | pattern, 有界 hits | totalMatches, truncated | head + total |
| web_search | query, rows[] | provider | 条数与 snippet 上限 |
| subagent | status, 摘要 | 子 call 计数 | 细节归档，模型看 summary |
| error | message / code | 可恢复建议 | 全文宜短 |

新增工具优先复用通用 kind（text / json / file_* / terminal）。只有 UI 或语义强依赖时再加专用 kind。

### C. 投影与截断元数据

模型侧载荷应避免 `output + stdout + log` 三份重复。原则是：

- **一个主 body**；
- 结构化事实字段单独保留；
- 截断信息显式标注。

```text
truncated: boolean
kept: head | tail | middle
removedLines? / removedBytes?
recoveryHint?   # 如何拿回省略部分
```

### 归档占位（剪裁后）

占位至少应可机器识别，并带恢复线索：

```text
kind: archived_tool_result
toolCallId / toolName
bodyHash 或 bodySha256
originalTokens / originalBytes
reason: pruned_exceeds_budget | snipped_old | active_prune | ...
artifactId? 或 fullOutputPath? 或 明确恢复指引
```

没有恢复路径的占位，只会让模型失忆，不能让模型自救。

## Registry 和 MCP

Registry 统一注册、查找、执行和生成工具定义。MCP 工具用 `mcp__server__tool` 命名，避免不同服务器重名，也让来源清楚。MCP 结果进入上下文时，同样走统一信封和剪裁规则，不要另起一套“原始 JSON 直接灌模型”。

## 工具失败后怎么办

错误信息要告诉模型下一步，例如“文件不存在，请用 glob 查找”，而不是只给 `ENOENT`。

程序侧还要兜底：

- 重复相同失败调用 → 提醒换思路或 loop-gate；
- 参数错误 → 返回校验明细和收到的参数摘要；
- 权限拒绝 / 用户取消 → 明确失败原因，不要假装成功；
- 超时 → 说明超时边界，避免模型以为命令已跑完。

## UI 的边界

Worker / Runtime 产生工具事件，Renderer 根据结构化数据展示。

- 开始：展示 running 与参数摘要；
- 过程：展示 partial output，不宣布完成；
- 结束：根据 success/error 与 details 渲染终态卡片；
- 后台：工具卡片可已完成，进程条仍可 running。

UI 可以压缩展示，但不能篡改事实；不能从一段自然语言输出反推增删行数、退出码或成功状态。

## 设计取舍

| 路线 | 特点 | 适合 |
|------|------|------|
| 扁平 `ToolResult` + JSON 字符串进模型 | 实现快、好读 | 桌面 Agent 快速迭代 |
| 判别联合 `ToolResultContent` + ledger/provider 分离 | 可审计、可归档、剪裁细 | 长任务、可恢复、多后端 |

无论选哪条，都应守住：

1. **完成看 end/result，不看 progress**；
2. **模型上下文必须有界**；
3. **结构服务决策，文本服务阅读**；
4. **后台进程生命周期单独建模**。

## 实际经验

- 工具输出通常比模型文字更占空间，先限制工具输出，再谈摘要压缩。
- 最近一轮工具结果往往最有决策价值，优先保护，不要和远古日志一视同仁。
- 流式预执行只适合只读工具；写工具必须等完整参数和权限。
- 同 turn 并行工具可以加速，但文件写冲突和权限确认要串行化关键路径。
- “工具返回成功”不等于“任务完成”，也不等于“后台服务已就绪”。
- 剪裁是降级能力，不能成为 Worker 崩溃的新原因；archive 失败时应保留原文或明确失败，而不是写入坏占位。
)
