import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { projectRoot, resolveRuntime } from './runtime.mjs';

try {
  const [command = 'dev', ...args] = process.argv.slice(2);
  const runtime = resolveRuntime();
  const helper = ['runtime', 'check-start', 'wait'].includes(command);
  const childArgs = helper
    ? [
        join(projectRoot, '.vscode/scripts/dev.mjs'),
        command === 'check-start' ? 'check' : command,
        ...args,
      ]
    : [
        runtime.npm,
        ...(command === 'ci'
          ? ['ci', ...args]
          : ['run', command === 'dev' ? 'dev:services' : command, ...args]),
      ];
  const child = spawn(runtime.node, childArgs, {
    cwd: projectRoot,
    env: runtime.env,
    stdio: 'inherit',
  });
  const forwardSignal = (signal) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      // Scope cleanup to the process tree created by this launcher.
      execFile(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        { windowsHide: true },
        () => {},
      );
      return;
    }
    // Keep the normal process group so IDE/test-runner force-kill also owns all children.
    // For a signal sent only to this launcher, enumerate and stop only its npm subtree.
    execFile('ps', ['-eo', 'pid=,ppid='], (error, stdout) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (error) {
        child.kill(signal);
        return;
      }
      const rows = stdout
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([child.pid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [pid, parent] of rows) {
          if (owned.has(parent) && !owned.has(pid)) {
            owned.add(pid);
            changed = true;
          }
        }
      }
      for (const pid of owned) {
        try {
          process.kill(pid, signal);
        } catch (failure) {
          if (failure.code !== 'ESRCH') process.stderr.write('本次子进程未能正常停止。\n');
        }
      }
    });
  };
  const interrupt = () => forwardSignal('SIGINT');
  const terminate = () => forwardSignal('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.once('error', () => {
    process.stderr.write('项目命令未能启动，请检查本地依赖与运行时。\n');
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : '项目启动失败。'}\n`);
  process.exitCode = 1;
}
