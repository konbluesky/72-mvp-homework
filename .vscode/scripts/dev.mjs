import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [command, portArg = '3000', webPortArg = '5173', mode = 'mock'] = process.argv.slice(2);
const apiPort = Number(portArg);
const webPort = Number(webPortArg);

async function checkRuntime() {
  const nodeVersion = (await readFile(resolve(root, '.nvmrc'), 'utf8')).trim();
  const { packageManager } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const npmVersion = packageManager.replace(/^npm@/, '');
  if (process.versions.node !== nodeVersion) {
    throw new Error(
      `需要 Node ${nodeVersion}，当前为 ${process.versions.node}。请执行 nvm install && nvm use，确保 VS Code 继承正确 PATH 后重新打开项目。`,
    );
  }
  let actualNpm;
  try {
    actualNpm = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`无法运行 npm；请将 Node ${nodeVersion} 自带的 npm 加入 VS Code PATH。`);
  }
  if (actualNpm !== npmVersion) {
    throw new Error(`需要 npm ${npmVersion}，当前为 ${actualNpm}；请检查 VS Code PATH。`);
  }
  process.stdout.write(`运行时通过：Node ${nodeVersion} / npm ${npmVersion}\n`);
}

async function checkPort(port, host) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `端口 ${host}:${port} 不可用（${error.code}）。请停止自己启动的服务，或修改 .vscode/settings.json 的 ${port === webPort ? 'mira.webPort' : 'mira.apiPort'}；本配置不会结束已有进程。`,
        ),
      );
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    });
  });
}

async function ready(url) {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(1500) });
  if (!response.ok) return false;
  const body = await response.json();
  return body.status === 'ready' && (mode === 'any' || body.mode === mode);
}

async function waitForReady() {
  if (!['mock', 'any'].includes(mode)) throw new Error('等待模式必须为 mock 或 any。');
  const deadline = Date.now() + 60_000;
  process.stdout.write(`等待前端 :${webPort}、API :${apiPort} 及 Vite 代理就绪……\n`);
  while (Date.now() < deadline) {
    try {
      const [pageReady, apiReady, proxyReady] = await Promise.all([
        globalThis
          .fetch(`http://127.0.0.1:${webPort}/`, {
            signal: globalThis.AbortSignal.timeout(1500),
          })
          .then(async (page) => page.ok && (await page.text()).includes('/src/webgal/main.tsx')),
        ready(`http://127.0.0.1:${apiPort}/readyz`),
        ready(`http://127.0.0.1:${webPort}/readyz`),
      ]);
      if (pageReady && apiReady && proxyReady) {
        process.stdout.write(`就绪：http://localhost:${webPort}\n`);
        return;
      }
    } catch {
      // Do not echo responses, environment variables or provider errors into task output.
    }
    await delay(300);
  }
  throw new Error(
    '60 秒内未就绪。请查看服务终端的启动错误，检查配置与端口；取消本次复合调试，不要选择“仍然调试”。',
  );
}

try {
  if (
    ![apiPort, webPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535) ||
    apiPort === webPort
  ) {
    throw new Error('mira.apiPort 与 mira.webPort 必须是 1–65535 之间且互不相同的端口。');
  }
  if (command === 'runtime' || command === 'check') await checkRuntime();
  if (command === 'check') {
    for (const dependency of ['tsx', 'concurrently', 'vite']) {
      try {
        await access(resolve(root, 'node_modules', dependency, 'package.json'));
      } catch {
        throw new Error('依赖未安装完整，请先在仓库根目录运行 npm ci。');
      }
    }
    for (const port of [apiPort, webPort]) {
      for (const host of ['127.0.0.1', '::1']) await checkPort(port, host);
    }
    process.stdout.write('依赖和端口通过；将运行已有 npm run dev。\n');
  } else if (command === 'wait') {
    await waitForReady();
  } else if (command !== 'runtime') {
    throw new Error(
      '用法：node .vscode/scripts/dev.mjs <runtime|check|wait> [API端口] [前端端口] [mock|any]',
    );
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'VS Code 启动检查失败。'}\n`);
  process.exitCode = 1;
}
