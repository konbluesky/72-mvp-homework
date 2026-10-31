import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { projectRoot, resolveRuntime, runtimeCandidates, runtimeEnvironment } from './runtime.mjs';

test('runtime lookup supports nvm without relying on the GUI process PATH', () => {
  const paths = runtimeCandidates('26.13.0', {
    env: { NVM_DIR: '/runtime/nvm' },
    home: '/user',
    execPath: '/system/old-node',
    platform: 'darwin',
  });
  assert.deepEqual(paths, ['/system/old-node', '/runtime/nvm/versions/node/v26.13.0/bin/node']);
});

test('child processes receive one selected PATH and retain debugger injection', () => {
  const original = { Path: '/legacy', PATH: '/other', NODE_OPTIONS: '--enable-source-maps' };
  const next = runtimeEnvironment('/selected/bin/node', original);
  assert.deepEqual(
    Object.keys(next).filter((key) => key.toLowerCase() === 'path'),
    ['PATH'],
  );
  assert.equal(next.PATH, `${dirname('/selected/bin/node')}${delimiter}/legacy`);
  assert.equal(next.NODE_OPTIONS, original.NODE_OPTIONS);
  assert.equal(original.PATH, '/other');
});

test('resolved Node and bundled npm match the repository versions', () => {
  const runtime = resolveRuntime();
  const env = { ...runtime.env, NODE_OPTIONS: '' };
  assert.equal(
    execFileSync(runtime.node, ['--version'], { encoding: 'utf8', env }).trim(),
    `v${runtime.version}`,
  );
  assert.equal(
    execFileSync(runtime.node, [runtime.npm, '--version'], { encoding: 'utf8', env }).trim(),
    runtime.npmVersion,
  );
});

test('launcher propagates command failures instead of reporting a successful start', () => {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, 'scripts/project.mjs'), '__missing_script_for_test__'],
    {
      cwd: projectRoot,
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
});
