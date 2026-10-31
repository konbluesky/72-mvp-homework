import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig, serverRoot } from './config/index.js';
import { cleanupLocalOrphans } from './media/index.js';

loadEnv({ path: resolve(serverRoot, '.env'), quiet: true });
try {
  const config = loadConfig();
  await cleanupLocalOrphans(config, true);
  const app = await createApp({ config });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      void app
        .close()
        .then(() => {
          clearTimeout(deadline);
        })
        .catch(() => {
          process.exitCode = 1;
        });
    });
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  // Configuration errors are already sanitized; startup never prints environment values.
  process.stderr.write(
    `${error instanceof Error && error.message.startsWith('Invalid server configuration:') ? error.message : 'Server startup failed. Check configuration, port and media directory.'}\n`,
  );
  process.exitCode = 1;
}
