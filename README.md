# codexhost light

`codexhost light` 是一个 Windows-only 的 Codex Desktop 外部 Harness 扩展层。

它只把 **DeepSeek Harness（DSH）** 和 **OpenCode** 作为独立 Thread 接入 Codex Desktop，同时保留 Codex 原生会话的官方运行路径。

## 设计边界

- Codex 原生会话由 Codex Desktop 官方 app-server 管理；codexhost light 不启动、代理、接管或持久化它们。
- DSH/OpenCode 通过独立的 External Host 子进程运行，使用本机 HTTP RPC 和 WebSocket 事件通道。
- Renderer 只把 DSH/OpenCode 的请求路由到 External Host；Codex 原生请求仍交给原始 RequestManager。
- Desktop 启动时使用官方 Codex CLI 路径，并过滤 `CODEXHOST_*` 环境变量，避免 Shim 介入原生会话。
- 发行插件只包含 DSH 和 OpenCode。
- 产品资源只使用 SVG 或内联 SVG，避免图片加密环境中的栅格资源问题。

## 功能

- DSH/OpenCode 独立 Thread 列表、恢复、流式输出和事件通知。
- 工具调用、审批、提问、取消和权限模式切换。
- 权限模式由 Harness 原生能力决定；可在 `default`、`ask`、`allow` 之间切换，并切回 `default`。
- External Host 关闭时会清理外部会话，不影响 Codex 原生会话。

## Windows 开发

需要 Node.js 24、npm 和 Rust toolchain。

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
```

构建 TypeScript 和 Rust：

```powershell
npm.cmd run build:typescript
npm.cmd run build:rust
```

## Windows 发布包

发布命令会生成可直接双击的 `codexhost-light-<version>-windows-x64.exe` 安装包。安装后从开始菜单点击 **codexhost light** 即可启动，不需要在公司电脑上安装 Node、npm 或 Rust：

```powershell
npm.cmd run release:package -- --target windows-x64
```

Launcher 会优先读取当前运行中的解压版 Codex，再从常见的 `Codex`/`OpenAI` 目录定位未注册 AppX 的解压版；因此 Codex 每次解压到新的版本目录也不需要改配置。若机器上同时存在多个未运行的副本，仍可用 `CODEXHOST_INSTALL_ROOT` 指定目录。

## Windows 验收

检查当前仓库是否有 External Host 残留：

```powershell
.\tools\windows-acceptance\audit-external-host.cmd `
  -CodexHostRoot D:\PowerQuant\codex-host
```

启动独立 External Host 冒烟检查：

```powershell
.\tools\windows-acceptance\smoke-external-host.cmd
```

如需清理测试遗留的 External Host：

```powershell
.\tools\windows-acceptance\cleanup-external-host.cmd
```

这些脚本只匹配 codexhost light 自己的 External Host，不会终止 Codex Desktop 或官方 app-server。

## 代码结构

- `packages/adapters/deepseek-harness`：DSH Adapter
- `packages/adapters/opencode`：OpenCode Adapter
- `packages/host-runtime`：External Host、Thread 映射和协议投影
- `packages/desktop-control`：Windows Desktop Controller
- `packages/renderer-extension`：Renderer Agent、请求路由和权限选择 UI
- `crates/launcher`、`crates/platform`、`crates/shim`：Windows 启动和进程隔离

## 当前限制

公司电脑上的 Codex Desktop UI 兼容性需要在真实生产环境单独验收。验收重点是 DSH/OpenCode Thread 是否正常显示，以及关闭 External Host 后 Codex 原生会话是否继续工作。
