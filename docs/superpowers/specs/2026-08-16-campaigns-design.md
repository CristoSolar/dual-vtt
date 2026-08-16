# Fase B: Campañas

Fecha: 2026-08-16

## Contexto

Fase A (cuentas y login) ya está en `main`: el GM crea cuentas de
jugador, cualquiera entra con usuario/contraseña, pero una vez logueado
el flujo de "sala" sigue siendo el de siempre — un código de 6
caracteres compartido de palabra, sin relación con las cuentas.

Esta fase reemplaza ese modelo por completo: el GM crea una campaña, le
agrega jugadores por cuenta (no por código), cada jugador crea su
personaje **dentro** de esa campaña (no en `localStorage` suelto) y ve
el mapa/escenas de esa campaña. El GM ve todo. Un jugador puede
pertenecer a varias campañas; un GM puede tener varias campañas activas
a la vez.

## Decisiones de alcance

- El modo actual "sin login, personaje en localStorage, sala por
  código" se **elimina por completo** — no convive con campañas.
- El código de 6 caracteres se **elimina**. La membresía la decide el
  GM agregando una cuenta de jugador ya existente a la campaña.
- Un jugador tiene **un solo personaje por campaña** (no varios a
  elegir).

## Lo que ya sirve tal cual

`RoomState` (`packages/protocol/src/room.ts`) ya contiene todo lo que
una campaña necesita: `gm`, `players`, `characters`, `fear`,
`spotlight`, `countdowns`, `adversaryInstances`, `activeEnvironment`,
`rollLog`, `map` (escenas/tokens/niebla). `applyRoomEvent` (el único
punto de mutación) y `roomForRole`/`roomPatch` (el filtrado GM/jugador)
no necesitan cambiar su lógica de juego — solo cambia **cómo se llega**
a un `RoomState` y **quién es el actor**.

## Modelo de datos nuevo

### `packages/protocol/src/room.ts`

- `RoomStateSchema.code: z.string().length(6)` → renombrado a
  `id: z.string().min(1)` (deja de ser un código pronunciable; es un id
  opaco). `createRoom(code, gm)` → `createRoom(id, gm)`, mismo cuerpo.
- `Player.id` y `GameMaster.id` pasan a ser directamente el **id de
  cuenta** (`User.id` de `@daggerheart/protocol`'s `auth.ts`), no un
  `sessionId` efímero generado por sala. Esto es lo que permite que
  reconectar sea "loguearse de nuevo", sin ningún token de asiento
  aparte.

### `packages/protocol/src/campaign.ts` (nuevo)

```ts
export const CampaignSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  ownerUsername: z.string().min(1),
  memberIds: z.array(z.string().min(1)),
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

export const CreateCampaignRequestSchema = z.object({ name: z.string().min(1).max(60) });
export const AddPlayerRequestSchema = z.object({ username: z.string().min(1) });
```

`CampaignSummary` es lo que las pantallas de "mis campañas" listan —
liviano, sin el `RoomState` completo adentro (eso viaja solo por
socket, como hoy).

### `apps/server/src/campaigns.ts` (nuevo, mismo patrón que `UserStore`)

```ts
interface CampaignRecord {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  state: RoomState;       // el ex-RoomState, con id/ids de cuenta
  seed: number;
  rollCount: number;
  updatedAt: number;
}

class CampaignStore {
  createCampaign(ownerId: string, ownerName: string, name: string): CampaignRecord;
  addMember(campaignId: string, ownerId: string, memberId: string): boolean; // false si no sos el owner
  removeMember(campaignId: string, ownerId: string, memberId: string): boolean;
  listFor(accountId: string): CampaignRecord[];   // dueño O miembro
  get(campaignId: string): CampaignRecord | null;
  roleOf(campaignId: string, accountId: string): 'gm' | 'player' | null;
  apply(campaignId: string, actor: Actor, event: RoomEvent, rng: Rng, now: number): ApplyOutcome;
  claimCharacter(campaignId: string, accountId: string, sheet: SheetState): ApplyOutcome;
  serialize(): SerializedCampaign[];
  restore(records: readonly SerializedCampaign[]): void;
}
```

Reemplaza a `RoomStore` (`apps/server/src/rooms.ts`), que se elimina.
`apply`/`claimCharacter` son básicamente lo que `RoomStore.apply`/
`.claimCharacter` ya hacían, menos toda la resolución de `Session` por
token — el actor llega resuelto desde afuera (ver Gateway).

Persistencia: mismo patrón que `users-snapshot.ts` —
`apps/server/src/campaigns-snapshot.ts`,
`.data/campaigns.json` (`CAMPAIGNS_SNAPSHOT_PATH`), escritura atómica.

## Autenticación del socket

Hoy el socket se autentica mandando `createRoom`/`joinRoom`/`resume`
con un código y recibiendo un token de asiento. Eso desaparece. El
socket ahora se conecta llevando el **token de login** (el mismo que ya
emite `POST /login` en Fase A):

```ts
io(SERVER_URL, { auth: { token }, transports: ['websocket'] });
```

`apps/server/src/gateway.ts` valida ese token contra el `SessionStore`
compartido con las rutas HTTP (mismo `SessionStore` de Fase A,
inyectado a `registerGateway`) apenas se conecta el socket; si no es
válido, desconecta. A partir de ahí `socket.data.accountId` queda fijo
para toda la conexión — no hace falta volver a autenticar por evento.

Nuevo evento, reemplaza a `createRoom`/`joinRoom`/`resume` juntos:

```ts
socket.on(CHANNEL.joinCampaign, (payload: { campaignId: string }) => {
  const role = store.roleOf(payload.campaignId, socket.data.accountId);
  if (role === null) return reject(socket, 'forbidden', 'not a member of that campaign');
  // join channels, send full state for that role — igual que hoy
});
```

`claimCharacter` e `intent` (los eventos de juego) ya no necesitan
`code`/`token` en el payload — el `campaignId` y el `accountId` quedan
en el socket desde el `joinCampaign`.

`CHANNEL` (`packages/protocol/src/events.ts`) pierde `createRoom`,
`joinRoom`, `resume`, `session`; gana `joinCampaign`. `CreateRoomSchema`,
`JoinRoomSchema`, `ResumeSchema`, `SessionSchema` se eliminan.
`ClaimCharacterSchema` pierde la necesidad de llevar `code`.

## Endpoints HTTP nuevos (mismo estilo que `auth-http.ts`)

`apps/server/src/campaigns-http.ts`:

- `POST /campaigns` — GM crea (`{name}` → `CampaignSummary`).
- `GET /campaigns` — las campañas del usuario logueado (dueño o
  miembro), como `CampaignSummary[]`.
- `POST /campaigns/:id/players` — solo el dueño; agrega por
  `{username}` (`404` si el username no existe, `403` si quien pide no
  es el dueño).
- `DELETE /campaigns/:id/players/:userId` — solo el dueño, saca a un
  jugador.

## Personaje: se crea dentro de la campaña

El reducer de creación (`packages/character`, 9 pasos) **no cambia
nada** — sigue siendo puro, sin saber nada de campañas. Lo que cambia
es el destino del resultado:

- Hoy: `finalize()` → `Character` → `apps/web/src/state/useCharacters.ts`
  lo guarda en `localStorage` como una entrada más de una lista libre.
- Ahora: `finalize()` → `Character` → se manda directo por socket como
  `claimCharacter` a la campaña activa, con el `accountId` ya resuelto
  del lado del servidor (no hace falta elegir "para cuál personaje", es
  el único que ese jugador puede tener en esa campaña).

El progreso a medio terminar del wizard se sigue guardando en
`localStorage` (`apps/web/src/state/storage.ts`'s `saveCreation`/
`loadCreation`), ahora con la clave incluyendo el `campaignId`, para
poder recargar la página sin perder el progreso — es solo un borrador,
no pasa por el servidor hasta `finalize()`.

`apps/web/src/state/useCharacters.ts` y las partes de `storage.ts` que
manejan la lista libre de personajes (`SAVED_CHARACTERS_KEY`,
`upsertCharacter`, `removeCharacter`, `ACTIVE_CHARACTER_KEY`) se
eliminan — ya no hay "biblioteca de personajes" fuera de una campaña.

## Web

### `apps/web/src/state/useCampaign.ts` (nuevo, reemplaza `useRoom.ts`)

Mismo rol que `useRoom` pero:
- Se conecta al socket con el token de `useAuth`, no con código/sesión
  de sala propia.
- `campaigns: CampaignSummary[]` — cargado por `GET /campaigns` al
  loguearse.
- `createCampaign(name)`, `addPlayer(campaignId, username)`,
  `removePlayer(campaignId, userId)` — llaman los endpoints HTTP.
- `join(campaignId)` — emite `joinCampaign`, guarda `activeCampaignId`
  en `localStorage` para reconectar directo a la misma campaña.
- `room: RoomState | null`, `send(event)` — igual que hoy, una vez
  adentro de una campaña.

### Rutas

- `CampaignsRoute.tsx` (nuevo) reemplaza a `CampaignRoute.tsx`: lista
  las campañas del usuario (`GET /campaigns`), un botón "Crear campaña"
  (solo tiene sentido mostrarlo siempre — cualquier cuenta puede ser
  dueña de una campaña, no solo la cuenta GM bootstrap), y click en una
  campaña → `join(campaignId)` → navega a `/`.
- `HomeRoute.tsx` pierde el formulario de unirse por código; si no hay
  campaña activa, muestra `CampaignsRoute`.
- Dentro de una campaña sin personaje reclamado (`role === 'player'`),
  en vez del botón "Reclamar personaje" que sube un personaje ya
  guardado en `localStorage`, se navega directo al wizard
  (`/create/1`), y el wizard al terminar hace el `claimCharacter`
  automáticamente.
- `PlayersRoute.tsx` (Fase A, gestión global de cuentas) no cambia — es
  ortogonal: crea *cuentas*, no las agrega a campañas. Agregar a una
  campaña específica es un flujo nuevo, dentro de `CampaignsRoute`
  (ej. un campo "agregar jugador" por campaña, que llama
  `POST /campaigns/:id/players` con un username ya existente).

## Tests existentes que hay que reescribir

`apps/server/test/helpers.ts` (`createRoomAs`, `joinRoomAs`,
`startTestServer`) y todo lo que se apoya en ellos —
`integration.test.ts`, `rolls.test.ts`, `map.test.ts` — están armados
sobre el flujo de código/token de `RoomStore`. Como `RoomStore`
desaparece, estos helpers se reescriben sobre `CampaignStore` +
autenticación por token de cuenta (crear cuentas de prueba, crear
campaña, agregar miembro, conectar el socket con su token). La lógica
que cada test verifica (permisos GM/jugador, filtrado de mapa, tiradas)
no cambia — solo cómo se llega a esa sala.

## Pruebas

- `packages/protocol/test/campaign.test.ts` — esquemas nuevos.
- `apps/server/test/campaigns.test.ts` — `CampaignStore`: crear,
  agregar/sacar miembro (con y sin ser el dueño), `listFor`, `roleOf`,
  serialize/restore.
- `apps/server/test/campaigns-http.test.ts` — cada endpoint, mismo
  estilo que `auth-http.test.ts`.
- `apps/server/test/gateway.test.ts` (o extender `integration.test.ts`)
  — conectar con token válido/inválido, `joinCampaign` como miembro y
  como no-miembro, que el GM vea todo y el jugador solo la escena
  activa — cubriendo lo que hoy prueba `integration.test.ts` pero
  contra el modelo de cuentas.
- `apps/web/test` — `useCampaign` (si es testeable sin socket real,
  mismo criterio que `useRoom` no lo es hoy — se deja a verificación
  manual como en Fase A) y cualquier función pura nueva en `storage.ts`.
