# Windows 外部 Host 验收

这些脚本在 Windows PowerShell 中运行，用来确认 Codex Desktop 的原生会话与 codexhost 进程隔离，同时确认 DSH/OpenCode 的 External Host 可启动。

```powershell
.\check-isolation.ps1 -CodexHostRoot C:\path\to\codex-host
.\smoke-external-host.ps1 -HostRuntime C:\path\to\codex-host\app\host-runtime.mjs
```

如果当前 PowerShell 的执行策略禁止脚本，使用同目录的 CMD 包装器即可：

```powershell
.\check-isolation.cmd -CodexHostRoot D:\PowerQuant\codex-host
.\smoke-external-host.cmd -HostRuntime D:\PowerQuant\codex-host\app\host-runtime.mjs
```

源码仓库没有 `app\host-runtime.mjs` 时，先执行 `npm run typecheck` 生成 `packages\host-runtime\dist\main.js`，然后可以省略 `-HostRuntime`，脚本会自动寻找该构建产物：

```powershell
npm run typecheck
.\tools\windows-acceptance\smoke-external-host.cmd
```

包装器只对这一次调用使用 `ExecutionPolicy Bypass`，不会修改系统或用户级执行策略。也可以直接使用一次性命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows-acceptance\check-isolation.ps1 -CodexHostRoot D:\PowerQuant\codex-host
```

验收要点：

- Desktop 进程树中不存在由 codexhost 启动的 `codex app-server`；
- Desktop 进程环境中不存在 `CODEXHOST_*` 变量；
- 结束 External Host 后，Codex 原生会话仍可创建和继续；
- External Host 仅接受本机 Bearer token，`initialize` 返回 `codexhost-external`；
- Renderer 中 DSH 和 OpenCode 的 thread 请求能通过 `/rpc` 到达 External Host。

脚本只做检查和启动，不会修改 Codex 配置，也不会终止现有 Desktop 进程。

如果需要清理意外遗留的 External Host 进程，只运行：

```powershell
.\cleanup-external-host.cmd
```

它只匹配带有 `--codexhost-external-host` 参数的进程，不会触碰 Codex Desktop、官方 app-server 或用户数据。

如果只想确认残留而不做任何修改，运行：

```powershell
.\audit-external-host.cmd -CodexHostRoot D:\PowerQuant\codex-host
```
