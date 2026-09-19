import { startExternalOnlyHostServer } from "./external-only-host.js";

const arguments_ = process.argv.slice(2);
process.exitCode =
  arguments_[0] === "--codexhost-external-host"
    ? await (async () => {
        const server = await startExternalOnlyHostServer(process.env);
        process.stderr.write(`codexhost external host listening at ${server.endpoint}\n`);
        await new Promise<void>((resolve) => {
          const stop = (): void => void server.close().finally(resolve);
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
        });
        return 0;
      })()
    : (() => {
        process.stderr.write(
          "codexhost: only --codexhost-external-host is supported; official Codex sessions are outside codexhost\n",
        );
        return 64;
      })();
