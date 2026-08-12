# Fase A: Cuentas y login

Fecha: 2026-08-12

## Contexto

Objetivo final (dos fases): el GM crea cuentas para sus jugadores, crea
campañas, agrega jugadores a una campaña, cada jugador crea su personaje
dentro de esa campaña y ve sus mapas/escenas; el GM ve todo. Esta fase
(Fase A) construye solo la base de cuentas y login. Las campañas (Fase B)
vienen después, en un spec y plan separados, y son las que conectan estas
cuentas con las salas/personajes/mapas existentes.

Hoy no existe ningún concepto de cuenta de usuario: las salas se unen con
un código de 6 caracteres tecleado a mano, y la sesión es un token de
asiento efímero (`apps/server/src/rooms.ts`), no ligado a una identidad
persistente. Esta fase no toca ese flujo de sala/código — sigue
funcionando igual, para cualquier usuario ya logueado. Fase B es la que lo
reemplaza por selección de campaña.

## Alcance de esta fase

- Cuentas de usuario persistentes (GM y jugador), con contraseña.
- Login / logout / sesión persistida en el navegador.
- El GM puede crear cuentas de jugador, listarlas, resetear su contraseña.
- Un jugador puede cambiar su propia contraseña.
- Arranque: la primera cuenta GM se crea sola a partir de variables de
  entorno.

Explícitamente fuera de esta fase: campañas, cualquier cambio al flujo de
sala/código actual, cualquier cambio a cómo se guardan los personajes.

## Modelo de datos

`packages/protocol/src/auth.ts` (esquemas Zod, igual que `sheet.ts` /
`room.ts` en el mismo paquete):

```ts
export const UserRoleSchema = z.enum(['gm', 'player']);

export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  mustChangePassword: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});

export const CreatePlayerRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
```

El hash de contraseña **nunca** entra en `UserSchema` — vive solo en el
almacenamiento del servidor, nunca se serializa hacia el cliente.

## Servidor

### `apps/server/src/users.ts`

Mismo patrón que `rooms.ts`: una clase `UserStore` con un `Map<string, StoredUser>`
en memoria (`StoredUser` = `User` + `passwordHash` + `salt`), más:

- `createUser(username, password, role): User` — genera `id`, sal
  aleatoria (`crypto.randomBytes(16)`), hash con
  `crypto.scrypt(password, salt, 64)` (callback envuelto en `promisify`),
  guarda `salt:hash` como un solo string hex separado por `:`.
- `verifyPassword(username, password): User | null` — reconstruye el hash
  con la sal guardada y compara con `crypto.timingSafeEqual` (nunca `===`
  sobre datos derivados de contraseña).
- `setPassword(userId, newPassword, mustChangePassword)`.
- `findByUsername`, `findById`, `list(role?)`.
- `serialize()` / `static restore(data)` — igual forma que
  `RoomStore.serialize`/`restore`, para conectar con el snapshot.

### Persistencia

`apps/server/src/snapshot.ts` ya sabe escribir/leer un JSON de forma
atómica para las salas. Se reusa la misma función genérica
(`writeSnapshot`/`readSnapshot`, que ya toman una ruta y un blob
serializable) con una ruta separada: `.data/users.json`
(`USERS_SNAPSHOT_PATH`, env var con ese default). Se escribe
inmediatamente después de cada mutación (crear usuario, cambiar
contraseña) — a diferencia de las salas, los cambios de cuenta son poco
frecuentes, así que no hace falta el snapshot periódico de 15s, un
`writeSnapshot` directo tras cada mutación alcanza.

### Sesiones

`apps/server/src/sessions.ts` (nuevo, pequeño): `Map<string, { userId: string }>`
en memoria, sin persistencia — un restart del servidor invalida las
sesiones (el usuario vuelve a loguearse, aceptable). Token: 32 bytes
random en hex (`crypto.randomBytes(32).toString('hex')`), mismo patrón que
`generateToken()` en `rooms.ts`.

### Endpoints HTTP

Mismo estilo que `apps/server/src/uploads.ts` (Node `http` puro, sin
Express, body JSON parseado a mano con límite de tamaño):

- `POST /login` → body `LoginRequestSchema`. Verifica con
  `UserStore.verifyPassword`; si falla, `401`. Si ok, crea sesión, responde
  `LoginResponseSchema`.
- `POST /logout` → header `Authorization: Bearer <token>`. Borra la
  sesión. `204`.
- `GET /me` → header `Authorization: Bearer <token>`. `401` si el token no
  existe en `SessionStore`; si existe, responde `UserSchema` del usuario.
- `POST /change-password` → requiere sesión válida. Body
  `ChangePasswordRequestSchema`. Verifica `currentPassword` contra el
  usuario de la sesión antes de aceptar `newPassword`. `401` si la actual
  no coincide.
- `GET /users` → requiere sesión con `role === 'gm'` (si no, `403`).
  Responde `User[]` (solo jugadores, sin hashes).
- `POST /users` → requiere GM. Body `CreatePlayerRequestSchema`. Crea con
  `role: 'player'`, `mustChangePassword: true`. Responde `UserSchema`.
- `POST /users/:id/reset-password` → requiere GM. Body
  `{ newPassword: string }`. Llama `setPassword(id, newPassword, true)`.

Todas las rutas nuevas se registran en el mismo `createServer` handler que
ya despacha `/uploads` en `apps/server/src/main.ts` — un `switch`/if-chain
por `req.url`/`req.method`, igual que hoy.

### Arranque (bootstrap del primer GM)

En `main.ts`, después de restaurar `UserStore` desde el snapshot: si
`store.findByUsername(GM_USERNAME)` no existe, se crea con
`GM_USERNAME`/`GM_PASSWORD` (env vars, default `'gm'`/`'gm'`) y
`role:'gm'`, `mustChangePassword:true`. Se imprime una advertencia clara
en consola si se usaron los valores por defecto ("usando credenciales GM
por defecto, cámbialas").

## Web

### `apps/web/src/state/auth.ts` (nuevo)

- `AUTH_STORAGE_KEY` en `localStorage`, mismo patrón que
  `apps/web/src/state/storage.ts` (Zod-parseado al leer, nunca `JSON.parse`
  crudo — trust boundary).
- `login(username, password): Promise<User>` — llama `POST /login`,
  guarda `{token, user}`.
- `logout()`, `me(): Promise<User | null>` — llama `GET /me` con el token
  guardado; si `401`, limpia el storage y devuelve `null`.
- `changePassword(current, next): Promise<void>`.

### `apps/web/src/routes/LoginRoute.tsx` (nuevo)

Formulario usuario/contraseña. En éxito, guarda sesión y navega a `/`.
Muestra el error del servidor (credenciales inválidas) sin detalle
adicional (no confirmar si el usuario existe).

### `apps/web/src/routes/ChangePasswordRoute.tsx` (nuevo)

Se muestra en vez de cualquier otra ruta cuando `user.mustChangePassword`
es `true`. Formulario contraseña actual + nueva. Al completar, refresca el
usuario en estado y navega a `/`.

### `apps/web/src/routes/PlayersRoute.tsx` (nuevo, solo GM)

Lista de jugadores (`GET /users`), formulario "crear jugador"
(usuario + contraseña inicial), botón "resetear contraseña" por fila.

### `App.tsx`

Al montar: lee token guardado, llama `me()`. Mientras resuelve, pantalla
de carga. Si no hay sesión válida → `LoginRoute` para cualquier ruta. Si
hay sesión y `mustChangePassword` → `ChangePasswordRoute` para cualquier
ruta. En otro caso, las rutas actuales (Home/Characters/Wizard/Sheet/Map)
siguen funcionando exactamente igual que hoy, más un link nuevo a
"Jugadores" visible solo si `role === 'gm'`.

## Pruebas

`apps/server/test/users.test.ts` (nuevo, seguir la forma de
`uploads.test.ts`): hashing/verificación de contraseña (correcta,
incorrecta, usuario inexistente), `setPassword`, serialize/restore
round-trip.

`apps/server/test/auth-http.test.ts` (nuevo): cada endpoint — login
correcto/incorrecto, `/me` con y sin token, `/change-password` con
contraseña actual incorrecta, `/users` y `POST /users` rechazados sin rol
GM, creación de jugador de punta a punta (crear → login con la clave
inicial → forced change-password).

`packages/protocol` — validar los esquemas nuevos con Zod (`.parse` /
`.safeParse` sobre inputs válidos e inválidos), mismo estilo que los tests
existentes del paquete.
