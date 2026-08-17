# Acceso remoto vía tunnel

Fecha: 2026-08-17

## Contexto

El server solo es alcanzable en `localhost` hoy. Para que jugadores se
conecten desde sus propias PCs (como Foundry con un tunnel) sin montar
hosting propio, se agrega un comando que expone el server temporalmente
con una URL pública HTTPS, usando un quick tunnel de Cloudflare
(`cloudflared`) — sin cuenta, sin costo, se cae si el GM cierra su PC (esa
es la contrapartida aceptada).

Con Fase A/B ya en `main`, no hace falta ningún mecanismo de código de
sala para esto: el jugador abre la URL del tunnel, ve la pantalla de
login, entra con la cuenta que el GM ya le creó. La URL del tunnel es lo
único que hay que compartir.

## Por qué no hace falta tocar CORS

Hoy `ALLOWED_ORIGINS` está fijo a `http://localhost:5173` porque en
desarrollo el front (Vite, puerto 5173) y el server (puerto 4000) son
orígenes distintos. Si el server también sirve el build de producción del
front (mismo puerto que la API), el navegador del jugador carga la página
*desde* la URL del tunnel y el socket conecta a ese mismo origen — deja de
ser cross-origin, así que `ALLOWED_ORIGINS` no necesita cambiar para nada,
sigue siendo exactamente como está para desarrollo local.

## Paquete `cloudflared`

Se agrega como dependencia de `apps/server`. Verificado contra el `.d.ts`
real del paquete (`node-cloudflared`, no contra documentación adivinada):

```ts
import { bin, install, Tunnel } from 'cloudflared';

// El binario no se instala solo con `pnpm install` — hay que asegurarlo
// antes de usarlo:
if (!fs.existsSync(bin)) await install(bin);

const t = Tunnel.quick('http://localhost:4000');
t.once('url', (url: string) => console.log(url));
t.once('error', (error: Error) => console.error(error));
// t.stop() para cerrar
```

`Tunnel` extiende `EventEmitter`; emite `'url'` una vez que Cloudflare
asigna el subdominio `https://*.trycloudflare.com`, `'connected'`,
`'disconnected'`, `'exit'`, `'error'`. En la práctica el propio
`postinstall` del paquete ya descarga el binario a su ruta por defecto
(`bin`) apenas se corre `pnpm install` — el chequeo
`existsSync(bin) || install(bin)` en `host.ts` queda solo como red de
seguridad para un setup que se instaló con `--ignore-scripts`.
`pnpm-workspace.yaml` necesita `allowBuilds: { cloudflared: true }` para
que ese postinstall corra (pnpm bloquea scripts de paquetes nuevos por
default).

## Servir el front construido

### `apps/server/src/static.ts` (nuevo)

Mismo estilo y garantías que `uploads.ts`: `handleStatic(request, response, distDir): Promise<boolean>`.

- Si `distDir` no existe (no se corrió el build, caso normal en
  desarrollo con `pnpm dev`), devuelve `false` inmediatamente para
  cualquier request — cero impacto en el flujo actual.
- Si existe: para `GET /` o cualquier ruta que no matchee un archivo real
  bajo `distDir`, sirve `index.html` — la app usa `HashRouter`
  (`apps/web/src/App.tsx`), así que el server nunca ve rutas de la SPA
  como `/campañas`, solo `/` y las URLs de sus assets (`/assets/...`); no
  hace falta un catch-all más elaborado que "si no es un archivo real,
  servir `index.html`".
- Para cualquier otra ruta GET, resuelve el archivo real dentro de
  `distDir` con las mismas guardas contra path traversal que
  `handleUploads`'s `GET /uploads/:name` ya usa (rechaza `..`, barras
  invertidas, cualquier ruta que no sea igual tras `normalize`).
- Tipo de contenido por extensión: `.html`, `.js`, `.css`, `.svg`, `.png`,
  `.webp`, `.woff2`, `.ico`, `.json` — el set que Vite realmente emite.

### `apps/server/src/main.ts`

Se agrega `handleStatic` al final de la cadena de fallthrough que ya
existe (`handleAuth` → `handleCampaigns` → `handleUploads` → ahora
`handleStatic` → 404). Nuevo env var `WEB_DIST_DIR` (default
`../web/dist`, resuelto contra `process.cwd()` — que ya es
`apps/server/` cuando se corre vía `pnpm -F @daggerheart/server ...`).
Nada más de `main.ts` cambia.

## `apps/server/src/host.ts` (nuevo) — el comando de un solo paso

Script para `pnpm -F @daggerheart/server host` (nuevo script en su
`package.json`). En orden:

1. Build del front con el origen relativo: corre
   `pnpm -F @daggerheart/web build` con `VITE_SERVER_URL=''` en el
   entorno — el socket y las llamadas HTTP del cliente terminan apuntando
   al mismo origen que sirvió la página, en vez de
   `http://localhost:4000` (que no existiría para un jugador remoto).
2. Levanta el server como proceso hijo: `pnpm -F @daggerheart/server start`
   (el mismo comando de siempre), con `stdio: 'inherit'` — sus logs
   (advertencia de credenciales GM por defecto, "listening on...") se ven
   en la misma terminal.
3. Asegura el binario de `cloudflared` (paso de arriba) y abre
   `Tunnel.quick('http://localhost:' + PORT)` contra el mismo `PORT` que
   usó el server (default 4000, mismo env var de siempre).
4. Al recibir la URL (evento `'url'`), imprime:
   `Enlace para compartir con tus jugadores: <url>`.
5. `SIGINT`/`SIGTERM` en `host.ts` para el tunnel (`t.stop()`) y mata el
   proceso hijo del server, en ese orden, antes de salir.

No hay opción de configuración adicional — un comando, una URL, listo.

## Seguridad (sin cambios de modelo, aclarar de nuevo)

La URL del tunnel no es el límite de confianza — igual que compartir un
link de ngrok o el código de sala de Foundry, cualquiera que la tenga
puede *ver la pantalla de login*, pero necesita credenciales reales
(usuario/contraseña que el GM ya creó) para hacer cualquier cosa. Nada de
esto cambia el modelo de autenticación ya construido en Fase A/B.

## Pruebas

`apps/server/test/static.test.ts` (nuevo, mismo patrón que
`uploads.test.ts`): sirve un `index.html` y un asset falso desde un
directorio temporal, verifica que devuelve `index.html` para `/` y para
una ruta desconocida, el asset real con el content-type correcto para su
propia ruta, y rechaza cualquier intento de path traversal. `host.ts` no
se testea automatizado (orquesta procesos y una llamada de red real a
Cloudflare) — se verifica a mano: correr el comando, confirmar que
imprime una URL `https://*.trycloudflare.com`, abrirla y ver la pantalla
de login.
