# 沙箱：给命令画权限红线，不是起一个容器

## 它解决什么问题

Agent 要在你真实的项目里跑 bash、装依赖、跑测试。一旦放它自由执行，风险就来了：prompt injection 可能让它读你的 SSH key 发出去、改你的 shell 启动脚本、删项目外的文件。

靠"每条命令弹窗确认"太慢，会让人麻木到盲点同意。沙箱是另一条路：**预先画好红线，红线内 agent 自己跑，红线外才停下来问。**

## 它不是 Docker

很多人把沙箱理解成 Docker 那种容器，其实不是。差别很大：

- **容器**：另起一个世界（独立文件系统、PID、网络命名空间），进程根本"看不见"外面。隔离靠"不在同一个空间"。
- **命令沙箱**：还在你的系统里，只是在系统调用层拦一下，allow/deny 谁能读写、能不能联网。隔离靠"规则不允许"。

一个是"把人关进另一个房间"，一个是"在同一个房间里画红线"。红线内能踩的地方，照样能干任何事。所以它防的是"非授权访问"，不是"强隔离逃逸"。

## 两层职责必须分开

沙箱设计最容易错的就是把"想限制什么"和"OS 上怎么强制"混在一起。要拆成两层：

- **权限语言（平台中立的数据）**：定义哪些路径可读可写、网络开不开、哪些元数据受保护。可序列化、可测试、跨平台复用。
- **平台后端（脏活）**：把权限语言翻译成 OS 原语。macOS 用 Seatbelt（`sandbox-exec` + SBPL），Linux 用 bubblewrap（namespace）+ seccomp，Windows 用 AppContainer。

权限语言是数据，后端是脏活，两者不耦合。这样换平台只换后端，权限规则不动。

## 沙箱只做命令变换，不做批准

这是最关键的一条边界：

- **沙箱把一条命令的 argv 改写成"被沙箱包裹的 argv"**，仅此而已。它不 spawn 进程、不重试、不弹 UI、不记 telemetry。
- **批准/拒绝由权限引擎决定**，沙箱不 grant approval。否则会出现"沙箱能跑 = 被批准了"的危险错觉。

一次 bash 命令的流程是：权限引擎决定要不要跑 → 沙箱把命令包成 `sandbox-exec -p <策略> -- <原命令>` → 执行器真正 spawn。沙箱只负责中间那一步。

## fail closed，绝不静默降级

后端不可用、profile 无效、平台不支持——都要返回 typed failure 停下，**绝不偷偷裸跑**。

这是沙箱和"普通功能"最大的区别：普通功能降级能跑就跑，沙箱降级等于没有沙箱。而且要给可读的失败原因（`backend_not_available` / `unsupported_platform` / `invalid_request`），不要只说"失败了"。

## 默认 deny + 白名单

策略用 `(deny default)` 起手，再逐项 allow——白名单语义，不是黑名单。黑名单漏一个就逃逸。workspace 根、tmpdir 通过变量注入策略，避免把路径硬编码进字符串。

**受保护元数据单独 deny-write**：像 `.git`、权限目录、审计目录，即便 workspace 可写也改不了这些——防 agent 改自己的约束/记忆/审计来作弊。

## 三种"隔离"别混成一回事

项目里经常有好几种都叫沙箱的东西，职责完全不同，要分清：

| 手段 | 场景 | 隔离什么 | 机制 |
|---|---|---|---|
| 临时目录全量复制 | 评测跑批 | run 之间文件副作用 | `cp -r` 到临时目录，用完删 |
| 命令沙箱 | 命令执行 | 单条命令的 OS 访问 | 内核 MAC 策略 |
| external profile | 已在容器/VM | 强隔离边界 | 让给环境 |

临时目录复制只防"agent 改坏源 fixture / 串到别的 run"，**不防逃逸**——绝对路径照样穿透。真正的安全要靠命令沙箱 + 权限 profile，不是临时目录。

## 模型怎么知道沙箱在干什么

沙箱强制是 OS 层做的，模型看不见。所以要把沙箱状态渲染成一段文本注入提示词，并标注"由 runtime 强制，不是建议"：

```
Maka runtime sandbox context (authoritative; enforced by the runtime):
  Profile: workspace-write
  File system: restricted
  Network: restricted
  Protected metadata: .git, .agents, .codex
  Command sandbox: available (macos-seatbelt)
```

开头那句"由 runtime 强制"是故意的——告诉模型这是硬约束、别试图绕过。能由程序保证的事，不只写在提示词里。

## 越权要走显式流程

受限 profile 下 agent 偶尔需要更高权限（装依赖要网络、跑容器要 socket）。不要临时切 profile，要走显式 escalation：

- agent 提一个 proposal：命令、cwd、理由、intent hash、command hash；
- 审批通过拿 grant，**带 TTL（几分钟）、一次性消费**；
- 消费时校验 command/cwd/intent 必须和 proposal 一致——防"申请 A 跑 B"；
- grant 在场时这次走 host 执行、不走沙箱，是"用户授权的越权"，不是沙箱漏洞。

## 几家怎么做（同一套技术谱系）

2025 年主流 agent CLI 的命令沙箱其实是**同一套技术**：macOS Seatbelt + Linux bubblewrap，连 profile 名字（`read-only` / `workspace-write` / `danger-full-access`）和 SBPL 策略结构都几乎逐行对应。差别在沙箱之上叠加的层。

| | maka | Codex CLI | Claude Code | pi |
|---|---|---|---|---|
| macOS | Seatbelt | Seatbelt | Seatbelt | 无沙箱 |
| Linux | bubblewrap（未接上） | bubblewrap + seccomp + landlock | bubblewrap + socat + seccomp | 无 |
| 网络 | 整体开/关 | HTTP/SOCKS5 代理 + 域名白名单 | SOCKS5 代理 + 域名白名单 | — |
| 凭证 | 受保护元数据 deny-write | glob deny（`**/*.env`） | deny + **mask**（代理替换真值） | 靠弹窗 |
| 越权 | 显式 escalation + TTL + intent 校验 | approval policy + reviewer agent | `dangerouslyDisableSandbox` 逃生舱 | 每条弹窗 |
| 整进程沙箱 | 无（只包 bash） | 无 | 有（sandbox-runtime 包整个进程） | — |
| 强隔离 | external（让给环境） | container/VM | dev container / VM / 云 VM | — |

pi 走的是完全不同的哲学：不做意图识别、不沙箱，靠"执行层确认弹窗"逐条拦。maka 的 AGENTS.md 也强调"客户端不做决策、安全通过执行层确认弹窗"，但 maka 在命令层额外加了沙箱，两者叠加。

## 花样不在内核原语

OS 原语给什么用什么，没有花样。花样全在沙箱之上：

- **网络代理层**（最大的分化点）：沙箱里所有流量走一个跑在沙箱外的代理，按域名 allow/deny、私网默认拦。比"整体开/关网络"细得多，是防数据外泄的关键。
- **凭证不落箱**：比"沙箱里 deny 读 `~/.ssh`"更彻底——让需要 token 的工具能跑，但 token 永不进沙箱；云版甚至把 git token 放沙箱外代理里，沙箱内只用 scoped 假凭证。
- **整进程沙箱**：不只包 bash，把 MCP server、hooks、file 工具也圈进边界，否则恶意 MCP server 是裸跑的。
- **组合边界**：内置进程沙箱 + 外层容器/VM。日常用进程沙箱（轻），不可信代码用 VM（强）。

## 经验

- 沙箱是"命令变换器"，不是"批准器"也不是"执行器"。
- 权限语言和平台后端分开；沙箱只做变换，不做批准。
- fail closed，绝不静默降级；要给可读的失败原因。
- 默认 deny + 白名单，不是黑名单；受保护元数据单独 deny。
- 临时目录复制不是安全沙箱；命令沙箱才是。
- 把沙箱状态作为"事实"注入提示词，标注"由 runtime 强制"。
- 越权走显式 escalation：intent 校验 + TTL + 一次性消费。
- 真正的花样在网络代理、凭证不落箱、整进程沙箱、组合边界——不在内核原语。