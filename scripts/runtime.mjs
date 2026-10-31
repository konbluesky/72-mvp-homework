import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function runtimeCandidates(version, options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const current = options.execPath ?? process.execPath;
  const binary = platform === 'win32' ? 'node.exe' : 'bin/node';
  return [
    env.MIRA_NODE_PATH,
    current,
    join(env.NVM_DIR || join(home, '.nvm'), 'versions/node', `v${version}`, binary),
    ...(env.NVM_HOME ? [join(env.NVM_HOME, `v${version}`, 'node.exe')] : []),
  ].filter(Boolean);
}

export function runtimeEnvironment(node, env = process.env) {
  const next = { ...env };
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === 'path');
  const previousPath = pathKey ? next[pathKey] : '';
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === 'path') delete next[key];
  }
  next.PATH = `${dirname(node)}${delimiter}${previousPath || ''}`;
  return next;
}

export function resolveRuntime() {
  const version = readFileSync(join(projectRoot, '.nvmrc'), 'utf8').trim();
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const npmVersion = pkg.packageManager.replace(/^npm@/, '');
  for (const candidate of new Set(runtimeCandidates(version))) {
    if (!existsSync(candidate)) continue;
    try {
      const node = realpathSync(candidate);
      const env = runtimeEnvironment(node);
      const actualVersion = execFileSync(node, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...env, NODE_OPTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (actualVersion !== `v${version}`) continue;
      const npmRoot =
        process.platform === 'win32'
          ? join(dirname(node), 'node_modules/npm')
          : resolve(dirname(node), '../lib/node_modules/npm');
      const npm = join(npmRoot, 'bin/npm-cli.js');
      if (!existsSync(npm)) continue;
      if (JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8')).version !== npmVersion)
        continue;
      return { node, npm, env, version, npmVersion };
    } catch {
      // A missing or incompatible candidate must not expose environment or child-process output.
    }
  }
  throw new Error(
    `未找到项目运行时 Node ${version} / npm ${npmVersion}。请安装 nvm 对应版本，或通过 MIRA_NODE_PATH 指定 node 可执行文件；不需要替换系统 Node。`,
  );
}
