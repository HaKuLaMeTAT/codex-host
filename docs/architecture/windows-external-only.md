# Windows 外部 Harness 精简架构

## 产品边界

当前发行目标只支持 Windows，并预装 DeepSeek Harness（DSH）与 OpenCode。Codex 原生会话不属于 codexhost 的会话模型，也不写入 codexhost 的映射存储。

目标运行链路分为两条：

```text
Codex 原生会话       Codex Desktop → 官方 app-server → Codex
外部 Harness 会话    Codexhost Renderer → 独立 Host 通道 → DSH/OpenCode
```

codexhost 不应再作为官方 app-server 的代理、认证持有者或生命周期管理器。Host 退出、崩溃或升级时，官方 Codex 链路必须继续运行；外部 Harness 失败也不得回退到官方 Codex。

## 实施阶段

1. 发行裁剪：只构建 DSH 与 OpenCode 插件，只向 Renderer 暴露这两个外部 Harness。
2. 平台裁剪：发行入口只接受 Windows；移除 macOS/Linux/Remote/Aqua Broker 路径及其资源。
3. 通道隔离：为外部 Thread 建立带随机令牌的本机 IPC/WebSocket 通道。Renderer 的外部请求不再复用官方 app-server 的请求代理；官方 RequestManager 只处理官方会话。
4. Host 解耦：将外部 Thread Host 从 `AppServerHost` 拆出，保留 `HarnessAdapter`、`protocol-core` 和 `mapping-store` 的公共契约。
5. 资源矢量化：codexhost 自有图标、Logo 和状态资源统一使用 SVG；禁止新增 PNG/JPEG/WebP 和 SVG 内嵌位图。Codex Desktop 官方资源不在本项目改写范围内。

## 隔离不变量

- 外部 Thread 不使用官方 Codex Thread ID、账号、模型、Session 文件或认证状态。
- 外部 Host 不启动、停止、重启或替换官方 app-server。
- 外部 Host 的异常只关闭 DSH/OpenCode Session 与其本地通道。
- 官方 app-server 的 stdin/stdout 不承载 DSH/OpenCode 请求。
- Host 只持久化 `(harnessId, nativeSessionId)` 与外部 Thread/Turn 映射。

## 当前落地状态

发行清单和 Renderer Agent 清单已收缩为 `deepseek-harness`、`opencode`，Codex 仍作为 Desktop 原生 Composer 保留，但不属于 codexhost 外部 Adapter。

当前已加入独立 External Host Runtime：Windows Launcher 启动官方 Codex Desktop 时不再注入 codexhost CLI Shim；Desktop Controller 另行启动带令牌的 External Host 子进程。`ExternalThreadHost` 是外部 Host 的组合入口，内部过渡复用 `AppServerHost` 的事件投影，但 `externalOnly` 模式不会初始化官方 app-server。Renderer 的外部请求通过本机 HTTP RPC + WebSocket 事件通道发送给它。发行源码和 TypeScript 引用已删除除 DSH/OpenCode 外的其他 Adapter。Host Runtime 默认入口现在拒绝所有旧官方/远程启动参数，只接受 External Host 入口。

第 1 项已完成关键隔离：`ExternalThreadHost` 的 `externalOnly` 构造不会创建官方 Runtime Scope、官方 Runtime Client 或 Codex Account Control；默认 Host 入口也拒绝旧官方/Remote 启动参数。第 2 项已补充 External HTTP 鉴权和 WebSocket token 边界测试。

DSH 和 OpenCode 的 Permission Mode 由各自 Adapter 提供并持久化：Renderer 可以在 `default`、`ask` 和 `allow`（由原生 Harness 暴露时）之间切换，切换后通过 `codexhost/thread/permission-mode/select` 写回原生 Session，随后也可以切回 `default`。不把权限选择写入 Codex 原生会话。

产品树中的图片资源只允许 SVG 或内联 SVG；`npm run lint` 会执行矢量资源检查，防止新增 PNG、JPEG、GIF 或 WebP。

仍需完成真实 Windows Desktop 验收：确认 AppX 启动不会重新注入 `CODEX_CLI_PATH`，确认 OpenCode/DSH 的流式事件、审批、提问和恢复在独立通道中完整投影，并补齐 Controller/Launcher 回归测试。
