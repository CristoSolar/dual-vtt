import { spawnSync } from 'node:child_process';

/**
 * `pnpm -F @daggerheart/server host` — builds the web app with a same-origin API
 * base (so the running server can serve it itself, no CORS relaxation needed) and
 * starts the server. Opening the tunnel is no longer this script's job — the GM
 * does that from the "Generar enlace" button in a campaign's card (see
 * `tunnel.ts`/`tunnel-http.ts`), which builds the app itself if this was skipped.
 */

console.log('Construyendo la app web (mismo origen que el server)…');
const build = spawnSync('pnpm', ['-F', '@daggerheart/web', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: '' },
});
if (build.status !== 0) {
  console.error('El build de la app web falló — revisa el error de arriba.');
  process.exit(1);
}

console.log('Iniciando el server. Desde la campaña, click en "Generar enlace" para compartirla.');
const server = spawnSync('pnpm', ['-F', '@daggerheart/server', 'start'], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(server.status ?? 0);
