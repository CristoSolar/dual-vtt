import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

import { bin, install, Tunnel } from 'cloudflared';

/**
 * `pnpm -F @daggerheart/server host` — one command that makes the table reachable
 * from outside this machine, the way sharing a Foundry/ngrok link works: build the
 * app so the server can serve it itself (same origin as the API, so nothing needs
 * to relax CORS), start the server, then open a Cloudflare quick tunnel to it and
 * print the public URL. No account, no cost, no config — it just stops working
 * if this process is closed, which is the accepted tradeoff for that simplicity.
 *
 * `cloudflared`'s own postinstall already downloads the binary to its default
 * `bin` path on `pnpm install` — the check below is just a safety net for a
 * setup where that was skipped (e.g. `--ignore-scripts`).
 */

const PORT = process.env.PORT ?? '4000';

async function main(): Promise<void> {
  console.log('Construyendo la app web (mismo origen que el server)…');
  const build = spawnSync('pnpm', ['-F', '@daggerheart/web', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_SERVER_URL: '' },
  });
  if (build.status !== 0) {
    console.error('El build de la app web falló — revisa el error de arriba.');
    process.exit(1);
  }

  console.log('Iniciando el server…');
  const server = spawn('pnpm', ['-F', '@daggerheart/server', 'start'], {
    stdio: 'inherit',
    env: process.env,
  });

  if (!existsSync(bin)) {
    console.log('Descargando cloudflared (solo la primera vez)…');
    await install(bin);
  }

  const tunnel = Tunnel.quick(`http://localhost:${PORT}`);
  tunnel.once('url', (url: string) => {
    console.log('');
    console.log(`Enlace para compartir con tus jugadores: ${url}`);
    console.log('Cada jugador entra con la cuenta que le creaste — no hace falta código de sala.');
    console.log('');
  });
  tunnel.on('error', (error: Error) => {
    console.error('El tunnel falló:', error.message);
  });

  const shutdown = (): void => {
    tunnel.stop();
    server.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('exit', (code) => {
    tunnel.stop();
    process.exit(code ?? 0);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
