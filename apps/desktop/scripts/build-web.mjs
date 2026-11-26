// Builds the web app for same-origin serving (empty VITE_SERVER_URL), the way
// `pnpm -F @daggerheart/server host` does — in Node, so it works on Windows too.
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['-F', '@daggerheart/web', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: '' },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
