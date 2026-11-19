# Features inspiradas en Foundry — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los huecos de mesa que Foundry VTT tiene y Dual VTT no: chat con tiradas privadas, objetivos, dados 3D, barra rápida, pings, diario con notas en el mapa, audio, tablas aleatorias y regiones.

**Architecture:** Todo cambio de estado sigue el modelo existente: schema Zod + reducer en `packages/protocol` (`applyRoomEvent`), el server solo transporta. Lo efímero (pings) va por un canal socket propio, fuera de `RoomState`. Lo privado (susurros, tiradas al GM) vive en un slice `privateLog` que `roomForRole('player')` vacía siempre, y llega a cada jugador por un canal socket por cuenta.

**Tech Stack:** TypeScript strict, Zod, Socket.io, React 18 + Konva, Vitest. Única dependencia nueva: `@3d-dice/dice-box-threejs` (solo web, Fase 3, carga diferida).

**Spec:** Este documento. Origen: análisis REA de un Foundry v13 (mundo dnd5e, vista de jugador) el 2026-10-18, cruzado con `docs/superpowers/specs/2026-08-21-vtt-parity-roadmap.md` (ítems 2, 5, 6) y `docs/plan-mejoras.md` Fase 4 (T1, T2, T3, T11). Evidencia REA: `ev_85ddf888…` (página), `ev_9e82dca0…` (targets).

## Global Constraints

- Capas: `srd-data → rules → character → protocol → server / web`. Nada importa hacia arriba.
- Todo campo nuevo persistido en `RoomState`, `Scene` o `Token` lleva `.default(...)` para que un snapshot viejo siga cargando.
- Estado GM-only se filtra en `roomForRole` / `mapForPlayer`; el navegador del jugador nunca lo recibe.
- Intents, no resultados: el cliente pide, el server calcula (HP, Difficulty, fila de tabla).
- Toda tirada sale de `rngForRoll(seed, rollCount)` en el server; cada evento que tira incrementa `rollCount`.
- El actor sale del socket (`gateway.ts`), nunca de un campo del cliente.
- Lecturas de `localStorage` se validan con Zod (`apps/web/src/state/storage.ts`).
- Texto de UI por `t()`; claves nuevas en `apps/web/src/i18n/es.ts` primero, `en.ts` tipado contra él.
- Imports relativos con `.js`; `import type` para tipos; nada de `!` sobre índices.
- Sin linter nuevo. Gate: `pnpm typecheck && pnpm test`.

## Review Focus

1. **Fuga de privados por patch**: una tirada privada nunca debe aparecer en `rollLog` ni en un `roomPatch` del canal de jugadores. Test en Task 1.2.
2. **Reconexión**: un jugador que recarga debe recuperar sus susurros y tiradas privadas (vía `roomForActor`), y no los de otros. Test en Task 1.3.
3. **Objetivo oculto**: un jugador no puede marcar como objetivo un token `hidden` ni de otra escena (`unknownToken`, igual que si no existiera). Test en Task 2.1.
4. **Spam de pings**: un cliente que manda 100 pings/seg no satura la mesa; el server descarta los que llegan antes de 500 ms. Test en Task 5.1.
5. **Autoplay bloqueado**: un jugador que entra con música sonando ve el botón "Activar sonido" y no un error en consola; la pista arranca en la posición actual, no desde cero. Test en Task 7.2.

---

## Fase 0 — Bug previo encontrado al planear

### Task 0.1: Toda tirada incrementa `rollCount`

`apps/server/src/campaigns.ts:207` solo cuenta `rollDuality` y `rollDamage`. `rollFate`, `rollAdversaryAttack` y `rollAdversaryDamage` reusan el índice de rng de la tirada anterior → la siguiente tirada repite dados. Las fases 1, 2 y 8 agregan más tiradas, así que se corrige primero.

**Files:**
- Modify: `apps/server/src/campaigns.ts:207`
- Test: `apps/server/test/rolls.test.ts`

- [ ] **Step 1: Test que falla**

```ts
it('advances the roll index for every event that rolls dice', () => {
  // GM tira dos veces rollFate seguidas: los valores salen de índices distintos.
  const store = /* CampaignStore con un GM, como en los tests existentes */;
  const a = store.apply(id, gm, { type: 'rollFate', /* … */ });
  const b = store.apply(id, gm, { type: 'rollFate', /* … */ });
  expect(store.get(id)?.rollCount).toBe(2);
});
```

- [ ] **Step 2:** `pnpm -F @daggerheart/server test rolls` → FAIL (`rollCount` = 0).
- [ ] **Step 3:** Reemplazar el `rollsThisEvent` por `result.entries.length > 0 ? 1 : 0`, calculado después de `applyRoomEvent`. (Con Fase 1 pasará a contar también `result.privateEntries`.)
- [ ] **Step 4:** Mismo comando → PASS; `pnpm test` completo verde.
- [ ] **Step 5:** `git commit -m "fix: every rolling event advances the dice index"`

---

## Fase 1 — Chat con visibilidad de tiradas (T3 + roadmap #2)

Decisiones:
- El chat **es** el roll log (como Foundry): nuevo `kind: 'message'` en `RollEntrySchema`. Un solo panel, un solo tope.
- Visibilidad: `'public' | 'private'`. Privado de jugador = el jugador + GM. Privado del GM = solo GM. Sin "blind"/"self": una tirada de Dualidad cambia Hope/Fear públicamente, así que ocultar el resultado al propio tirador no tiene sentido. El GM ve todos los susurros (igual que Foundry).
- Lo privado no viaja en patches: `privateLog` es `[]` en la vista de jugador, así que el diff del canal de jugadores nunca lo toca y lo que el cliente agregó localmente no se pisa.

### Task 1.1: Schemas de mensaje y entrada privada

**Files:**
- Modify: `packages/protocol/src/rollLog.ts` (nuevo kind), `packages/protocol/src/room.ts:150-229` (slice), `packages/protocol/src/events.ts` (intent + campo `visibility`)
- Test: `packages/protocol/test/room.test.ts`

**Interfaces — Produces:**
- `RollEntrySchema` gana `{ kind: 'message', id, at, by, byId: string, text: string /* 1..500 */ }`
- `VisibilitySchema = z.enum(['public', 'private'])`, exportado desde `rollLog.ts`
- `PrivateEntrySchema = z.object({ audience: z.array(z.string().min(1).max(64)).max(12), entry: RollEntrySchema })`; `type PrivateEntry`
- `RoomState.privateLog: PrivateEntry[]` con `.default([])`; tope `MAX_ROOM_LOG`
- Intent nuevo `sendMessage { text: z.string().trim().min(1).max(500), whisperTo: z.array(accountId).max(12).default([]) }` en un nuevo `TableRoomEventSchema` (cualquier rol), unido a `RoomEventSchema`
- `visibility: VisibilitySchema.default('public')` agregado a `rollDuality`, `rollDamage`, `rollFate`, `rollAdversaryAttack`, `rollAdversaryDamage`
- `RoomResult` ok gana `privateEntries: readonly PrivateEntry[]`; `ok()` recibe un 4º parámetro con default `[]`

- [ ] **Step 1: Tests que fallan**

```ts
it('posts a public message to the log, signed by the actor', () => {
  const r = applyRoomEvent(state, player, { type: 'sendMessage', text: 'hola', whisperTo: [] }, rng, 1000);
  expect(r.ok && r.state.rollLog[0]).toMatchObject({ kind: 'message', text: 'hola', byId: player.id });
});

it('keeps a whisper out of the public log', () => {
  const r = applyRoomEvent(state, player, { type: 'sendMessage', text: 'psst', whisperTo: [other.id] }, rng, 1000);
  expect(r.ok && r.state.rollLog).toHaveLength(0);
  expect(r.ok && r.state.privateLog[0]?.audience.sort()).toEqual([other.id, player.id].sort());
});

it('routes a private duality roll to privateLog with the roller as audience', () => {
  const r = applyRoomEvent(state, player, { type: 'rollDuality', characterId, request: { ...req, visibility: 'private' } }, rng, 1000);
  expect(r.ok && r.state.rollLog).toHaveLength(0);
  expect(r.ok && r.privateEntries[0]?.audience).toEqual([player.id]);
});

it('a private GM roll has an empty audience: GM only', () => { /* rollFate visibility private → audience [] */ });

it('loads a snapshot saved before privateLog existed', () => {
  const { privateLog, ...old } = createRoomState('c', gm);
  expect(RoomStateSchema.parse(old).privateLog).toEqual([]);
});
```

(Ajustar dónde vive `visibility` en cada intent según su forma: dentro de `request` para `rollDuality`, al nivel del intent para los demás. Decidir uno y usarlo igual en todos — recomendado: **nivel intent** en todos, incluido `rollDuality`.)

- [ ] **Step 2:** `pnpm -F @daggerheart/protocol test room` → FAIL.
- [ ] **Step 3:** Implementar `logEntries(state: RoomState, actor: Actor, entries: readonly RollEntry[], visibility: Visibility): { state: RoomState; privateEntries: PrivateEntry[] }` en `room.ts`, reemplazando las llamadas a `appendEntries` de los cinco casos de tirada. `public` → `appendEntries` de siempre. `private` → audiencia `actor.role === 'gm' ? [] : [actor.id]`, al frente de `privateLog`, cortado a `MAX_ROOM_LOG`; `entries` del resultado va vacío. Caso `sendMessage`: arma la entrada con `id` derivado de `now` + `rng` como los demás, `by` = nombre del jugador/GM en `state.players`/`state.gm`; si `whisperTo` está vacío es público, si no, audiencia = `whisperTo ∪ {actor.id}` sin el GM (GM implícito).
- [ ] **Step 4:** Mismo comando → PASS. `pnpm -F @daggerheart/protocol typecheck` limpio.
- [ ] **Step 5:** `git commit -m "feat(protocol): chat messages and private rolls"`

### Task 1.2: Vistas por rol y por actor

**Files:**
- Modify: `packages/protocol/src/room.ts:262` (`roomForRole`), nuevo `roomForActor`
- Test: `packages/protocol/test/room.test.ts`

**Interfaces — Produces:** `roomForActor(state: RoomState, actor: Actor): RoomState` — GM: `state`; jugador: `roomForRole(state, 'player')` con `privateLog` filtrado a entradas cuyo `audience` incluye `actor.id`.

- [ ] **Step 1: Tests que fallan**

```ts
it('never hands privateLog to the player channel', () => {
  expect(roomForRole(withWhisper, 'player').privateLog).toEqual([]);
});
it('player patch is empty when only privateLog changed', () => {
  expect(roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player'))).toEqual({});
});
it('roomForActor gives a player their own private entries and no one else’s', () => {
  expect(roomForActor(state, playerA).privateLog.map((p) => p.entry.id)).toEqual(['mine']);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** `roomForRole` agrega `privateLog: []`; implementar `roomForActor`. Exportar desde `index.ts`.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(protocol): per-actor view of private entries"`

### Task 1.3: Transporte de privados en el server

**Files:**
- Modify: `apps/server/src/gateway.ts:38-47,150-175`, `apps/server/src/campaigns.ts:204-224`, `packages/protocol/src/events.ts:17` (`CHANNEL`)
- Test: `apps/server/test/integration.test.ts`

**Interfaces:**
- Consumes: `roomForActor`, `RoomResult.privateEntries` (Task 1.1–1.2)
- Produces: `CHANNEL.privateRolled = 'privateRolled'`, payload `PrivateRolledSchema = z.object({ entries: z.array(PrivateEntrySchema) })`; `userChannelFor(campaignId, accountId) = \`campaign:${campaignId}:user:${accountId}\``; `ApplyOutcome` ok gana `privateEntries`

- [ ] **Step 1: Tests de integración que fallan** (dos jugadores + GM conectados por socket, como los existentes)

```ts
it('delivers a whisper to its audience and the GM only', async () => {
  // A susurra a B → B y GM reciben privateRolled; C no recibe nada.
});
it('a reconnecting player gets their private entries back in roomState', async () => {
  // A tira privado, se desconecta, reconecta → roomState.privateLog tiene su entrada.
});
it('no roomPatch to the player channel carries privateLog', async () => { /* escucha roomPatch en C */ });
```

- [ ] **Step 2:** `pnpm -F @daggerheart/server test integration` → FAIL.
- [ ] **Step 3:** `joinChannels` también une `userChannelFor`. `sendFullState(socket, campaigns, campaignId, actor: Actor)` usa `roomForActor`. En el handler `intent`, si `outcome.privateEntries.length > 0`, por cada entrada `io.to([gmChannelFor(id), ...entry.audience.map((a) => userChannelFor(id, a))]).emit(CHANNEL.privateRolled, { entries: [entry] })` (Socket.io deduplica sockets entre rooms). `CampaignStore.apply` pasa `privateEntries` y cuenta `rollCount` con `entries.length + privateEntries.length > 0`.
- [ ] **Step 4:** PASS + `pnpm test` verde.
- [ ] **Step 5:** `git commit -m "feat(server): deliver private rolls and whispers per account"`

### Task 1.4: UI — panel de chat y toggle de privacidad

**Files:**
- Modify: `apps/web/src/state/useCampaign.ts` (escuchar `privateRolled`), `apps/web/src/components/sheet/RollLogPanel.tsx`, `apps/web/src/components/sheet/RollDialog.tsx`, `apps/web/src/components/gm/GMPanel.tsx` (tiradas de adversario/fate), `apps/web/src/i18n/es.ts`, `en.ts`, `describeRollEntry` en `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/state/feed.ts`
- Test: `apps/web/test/feed.test.ts`, `apps/web/test/render.test.tsx`

**Interfaces — Produces:** `mergeFeed(rollLog: readonly RollEntry[], privateLog: readonly PrivateEntry[]): Array<{ entry: RollEntry; private: boolean }>` — orden por `at` descendente, sin duplicados por `entry.id`. `appendPrivate(state: RoomState, entries: readonly PrivateEntry[]): RoomState` — pura, dedup por id.

- [ ] **Step 1: Tests que fallan**: `mergeFeed` intercala por `at` y marca privados; `appendPrivate` ignora un id repetido; render: un mensaje `kind: 'message'` muestra autor y texto; una entrada privada lleva la etiqueta `t('log.private')`.
- [ ] **Step 2:** `pnpm -F @daggerheart/web test feed render` → FAIL.
- [ ] **Step 3:** Implementar. Caja de texto al pie de `RollLogPanel` (form, Enter envía, `maxLength=500`), selector "Para: Todos / GM / <jugador>…" que llena `whisperTo`: Todos = `[]`, GM = `[gm.id]`, jugador = `[playerId]`. Toggle "Privado" (checkbox) en `RollDialog` y en los botones de tirada del GM, que manda `visibility`. Filtro existente del log gana tipo "Mensajes". Texto plano con `white-space: pre-wrap`, sin markdown.
- [ ] **Step 4:** PASS + `pnpm -F @daggerheart/web typecheck`.
- [ ] **Step 5:** Probar a mano: `pnpm dev`, GM + jugador en dos ventanas, susurro y tirada privada visibles solo donde corresponde. `git commit -m "feat(web): chat box, whispers and private rolls"`

---

## Fase 2 — Objetivos (targeting)

Decisiones:
- Cada cuenta tiene sus objetivos: `targets: Record<accountId, tokenId[]>` (máx 6), público para la mesa (Foundry muestra quién apunta a quién).
- `rollDuality` con `targetTokenId` → el server toma la **Difficulty del adversario** del SRD y pisa `request.difficulty`. La Difficulty se revela en el log (decisión: el SRD deja al GM decidir; ocultarla requiere separar el `rolled` por canal — subir cuando un GM lo pida).
- Daño al objetivo: intent GM-only `applyDamageToAdversary`, el server marca HP por umbrales con `applyDamage` de `rules`.

### Task 2.1: Slice y intent `setTargets`

**Files:** Modify `packages/protocol/src/room.ts`, `events.ts` · Test `packages/protocol/test/room.test.ts`

**Interfaces — Produces:** `RoomState.targets: z.record(z.string(), z.array(z.string().min(1).max(64)).max(6)).default({})`; intent `setTargets { tokenIds: z.array(tokenId).max(6) }` en `TableRoomEventSchema`; `[]` borra la entrada de la cuenta.

- [ ] **Step 1: Tests que fallan**
  - jugador marca un token visible de la escena activa → `state.targets[player.id]` = `[tokenId]`
  - jugador marca un token `hidden: true` → `{ ok: false, error: 'unknownToken' }`
  - token de otra escena → `unknownToken`
  - `removeToken` de un token apuntado lo saca de todos los `targets`
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; jugador valida contra `mapForPlayer(state.map)`, GM contra el mapa entero. En el caso `removeToken`/`removeScene` limpiar ids huérfanos.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(protocol): per-account targets"`

### Task 2.2: Tirada contra objetivo y daño a adversario

**Files:** Modify `packages/protocol/src/room.ts` (caso `rollDuality`, nuevo caso), `events.ts`, `rollLog.ts` · Test `packages/protocol/test/room.test.ts`

**Interfaces:**
- `rollDuality` gana `targetTokenId: tokenId.optional()`; entrada `duality` gana `target: z.string().nullable().default(null)` (nombre del token)
- Intent GM-only `applyDamageToAdversary { instanceId, amount: z.number().int().min(0).max(999) }` → `hpMarked += applyDamage({ incoming: amount, thresholds }).hpMarked`, tope en `hp` del stat block. Minion (thresholds `null`) → 1 HP por golpe. Severe `null` → severidad máxima Major.

- [ ] **Step 1: Tests que fallan**
  - target adversario con `difficulty: 14` en SRD y `request.difficulty: 10` → entrada con `difficulty: 14`, `target: '<nombre token>'`
  - target `marker` o `pc` → usa `request.difficulty`, `target` = nombre
  - `applyDamageToAdversary` con amount sobre Severe → +3 HP (o lo que diga `applyDamage`); jugador → `notGameMaster`
  - HP nunca supera el máximo del adversario
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; la Difficulty se lee en el server de `srd().adversaries`, nunca del cliente.
- [ ] **Step 4:** PASS. **Step 5:** `git commit -m "feat(protocol): roll against a target's Difficulty, damage adversaries by threshold"`

### Task 2.3: UI de objetivos

**Files:** Modify `apps/web/src/components/map/MapCanvas.tsx`, `TokenPopover.tsx`, `RollDialog.tsx`, `RollLogPanel.tsx`, `GMPanel.tsx`, i18n · Create `apps/web/src/state/playerColor.ts` (lo usa también Fase 5) · Test `apps/web/test/playerColor.test.ts`

**Interfaces — Produces:** `colorFor(accountId: string): string` — hash estable del id a una paleta fija de 8 colores accesibles sobre el fondo del mapa; GM siempre el mismo color.

- [ ] **Step 1:** Test: `colorFor` es determinista y dos ids distintos de la paleta de prueba dan colores distintos.
- [ ] **Step 2:** FAIL. **Step 3:** Tecla `T` o botón en `TokenPopover` → `setTargets`. Marca de objetivo (anillo punteado con `colorFor` del que apunta) en Konva. `RollDialog` muestra "Objetivo: X" y manda `targetTokenId` del primer objetivo propio. Entrada de daño en el log: botón GM "Aplicar a objetivo" si el autor tenía objetivo adversario. `rollAdversaryAttack` del GM prellena `targetId` si su objetivo es un token `pc`.
- [ ] **Step 4:** PASS + typecheck. **Step 5:** Prueba manual en `pnpm dev`; `git commit -m "feat(web): target tokens and roll against them"`

---

## Fase 3 — Dados 3D de Dualidad

Solo cliente. El server ya tiró; la animación **muestra** el resultado, nunca lo decide.

### Task 3.1: Spike de librería (timebox 2 h)

- [ ] Instalar `@3d-dice/dice-box-threejs` en `apps/web` (versión exacta, sin `^`).
- [ ] Confirmar que acepta resultado predeterminado (`'2d12@7,3'`) y colores por dado. Si no lo hace: **parar** y anotar alternativa (`@3d-dice/dice-box` + forzar caras) antes de seguir.
- [ ] Confirmar que se puede importar con `import()` dinámico (no entra al bundle inicial). Medir peso del chunk.

### Task 3.2: Overlay de dados

**Files:** Create `apps/web/src/components/dice/DiceOverlay.tsx`, `apps/web/src/state/diceNotation.ts` · Modify `useCampaign.ts` (al recibir `rolled`/`privateRolled`), `storage.ts` (preferencia), i18n · Test `apps/web/test/diceNotation.test.ts`

**Interfaces — Produces:** `notationFor(entry: RollEntry): Array<{ notation: string; color: 'hope' | 'fear' | 'neutral' }> | null` — `duality` → `1d12@<hope>` hope + `1d12@<fear>` fear (+ `1d6@<n>` por ventaja/desventaja); `damage` → `<n>d<die>@<rolls>`; `attack` → `1d20@<die>`; `message`/`fate` → `null`.

- [ ] **Step 1:** Tests de `notationFor` para cada kind, con valores exactos.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. Hope dorado, Fear violeta (tokens de color del rediseño). Toggle "Dados 3D" en ajustes, guardado en `localStorage` con schema Zod; apagado por defecto si `prefers-reduced-motion: reduce`. Overlay `pointer-events: none`, se limpia a los 3 s.
- [ ] **Step 4:** PASS. **Step 5:** Prueba manual; `git commit -m "feat(web): 3D duality dice"`

---

## Fase 4 — Barra rápida (hotbar)

Solo cliente, por cuenta y campaña en `localStorage`. Sin protocolo.

### Task 4.1: Modelo de slots

**Files:** Create `apps/web/src/state/hotbar.ts` · Modify `storage.ts` · Test `apps/web/test/hotbar.test.ts`

**Interfaces — Produces:**
- `HotbarSlotSchema = z.discriminatedUnion('kind', [{ kind: 'trait', trait }, { kind: 'weapon', slot: 'primary'|'secondary' }, { kind: 'card', cardId }, { kind: 'experience', name }])`
- `HotbarSchema = z.array(HotbarSlotSchema.nullable()).length(10)`
- `loadHotbar(campaignId, accountId): Hotbar` (inválido → 10 `null`), `saveHotbar(...)`, `setSlot(bar, index, slot): Hotbar`
- `rollRequestFor(slot, sheet): RollRequest | null` — `null` si la carta ya no está en el loadout o el arma no está equipada

- [ ] **Step 1:** Tests: JSON corrupto → barra vacía; `setSlot` fuera de 0–9 no cambia nada; `rollRequestFor` de carta en el vault → `null`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** `git commit -m "feat(web): hotbar model"`

### Task 4.2: UI de barra

**Files:** Create `apps/web/src/components/sheet/Hotbar.tsx` · Modify `MapRoute.tsx`, `SheetRoute.tsx`, i18n · Test `render.test.tsx`

- [ ] **Step 1:** Test de render: slot con trait muestra su nombre; slot vacío tiene `aria-label` "Espacio vacío N".
- [ ] **Step 2:** FAIL. **Step 3:** Arrastrar desde la hoja (trait, arma, carta, experiencia) al slot; clic o teclas `1`–`0` (ignoradas si el foco está en un input/textarea) abren `RollDialog` precargado. Clic derecho limpia. **Step 4:** PASS. **Step 5:** `git commit -m "feat(web): hotbar with number keys"`

---

## Fase 5 — Pings en el mapa (T1)

Efímero: no toca `RoomState` ni snapshot.

### Task 5.1: Canal de ping

**Files:** Modify `packages/protocol/src/events.ts` (`CHANNEL.ping`, `CHANNEL.pinged`, schemas), `apps/server/src/gateway.ts` · Test `apps/server/test/integration.test.ts`

**Interfaces — Produces:** `PingSchema = z.object({ sceneId, x: z.number().finite(), y: z.number().finite() })`; `PingedSchema = PingSchema.extend({ byId: z.string() })`. Constante `PING_COOLDOWN_MS = 500`.

- [ ] **Step 1: Tests que fallan**: ping de jugador sobre la escena activa → todos reciben `pinged` con `byId`; ping sobre escena no activa desde jugador → descartado; dos pings en < 500 ms del mismo socket → solo el primero se reenvía.
- [ ] **Step 2:** FAIL. **Step 3:** Handler en `gateway.ts` con `Map<Socket, number>` del último ping; `stillMember` igual que `intent`. **Step 4:** PASS. **Step 5:** `git commit -m "feat: map pings"`

### Task 5.2: Animación

**Files:** Modify `MapCanvas.tsx`, `useCampaign.ts`

- [ ] Alt+clic (o mantener presionado 600 ms en táctil) → `ping`. Al recibir `pinged`: anillo que crece 2 s en `colorFor(byId)`; con `prefers-reduced-motion` un anillo fijo que se desvanece. GM con Shift+Alt+clic además centra la vista de todos — **fuera de alcance**, anotar si lo piden.
- [ ] Prueba manual en dos ventanas; `git commit -m "feat(web): ping animation"`

---

## Fase 6 — Diario y notas en el mapa (T2 + roadmap #5)

Decisiones: entradas compartidas con `'gm' | 'all'` (por jugador individual requeriría el patrón de `privateLog`; subir si se pide). Texto plano, sin markdown. Imagen opcional vía `/uploads`.

### Task 6.1: Slice `journal` y notas de escena

**Files:** Create `packages/protocol/src/journal.ts` · Modify `room.ts`, `map.ts` (`SceneSchema`), `events.ts`, `index.ts` · Test `packages/protocol/test/journal.test.ts`

**Interfaces — Produces:**
- `JournalEntrySchema = z.object({ id, title: z.string().min(1).max(80), body: z.string().max(20_000), image: SceneImageSchema.nullable(), shared: z.enum(['gm', 'all']) })`
- `RoomState.journal: JournalEntry[]` `.max(100).default([])`
- `SceneSchema.notes: z.array(z.object({ id, x, y, journalId })).max(100).default([])`
- Intents GM-only: `upsertJournalEntry { entry }`, `removeJournalEntry { id }` (borra también sus notas en todas las escenas), `addNote { sceneId, note }`, `removeNote { sceneId, noteId }`

- [ ] **Step 1: Tests que fallan**: jugador → `notGameMaster`; `roomForRole('player')` solo trae entradas `shared: 'all'` y solo notas cuyo `journalId` está compartido; borrar entrada borra sus notas; snapshot sin `journal` carga.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; filtro de notas en `roomForRole` (necesita el journal, por eso no en `mapForPlayer`). **Step 4:** PASS. **Step 5:** `git commit -m "feat(protocol): journal entries and map notes"`

### Task 6.2: UI de diario

**Files:** Create `apps/web/src/components/journal/JournalPanel.tsx` · Modify `MapCanvas.tsx` (pin), `MapRoute.tsx`, i18n · Test `render.test.tsx`

- [ ] Panel flotante (`FloatingPanel`) con lista + editor (GM) o lector (jugador). Botón "Mostrar a jugadores" = `shared: 'all'`; en el cliente del jugador, una entrada que pasa a compartida abre un `Dialog` una vez (recordar ids vistos en memoria, no en storage). Pin en el mapa abre la entrada.
- [ ] Test de render: jugador no ve botón de editar. Prueba manual. `git commit -m "feat(web): journal panel and map pins"`

---

## Fase 7 — Audio sincronizado (T11 + roadmap #6)

### Task 7.1: Uploads de audio y slice

**Files:** Modify `apps/server/src/uploads.ts:32-36`, `packages/protocol/src/room.ts`, `events.ts` · Test `apps/server/test/uploads.test.ts`, `packages/protocol/test/room.test.ts`

**Interfaces — Produces:**
- Tipos nuevos en el allowlist por magic bytes: `.ogg` `audio/ogg` `[0x4f,0x67,0x67,0x53]`; `.mp3` `audio/mpeg` `[0x49,0x44,0x33]` (ID3). El límite `MAX_UPLOAD_BYTES` (20 MB) sirve.
- `RoomState.audio: z.object({ tracks: z.array(z.object({ id, name: z.string().min(1).max(80), url })).max(50), playing: z.object({ trackId, startedAt: z.number(), loop: z.boolean(), volume: z.number().min(0).max(1) }).nullable() }).default({ tracks: [], playing: null })`
- Intents GM-only: `addTrack`, `removeTrack` (si suena, `playing: null`), `playTrack { trackId, loop }` (server pone `startedAt = now`), `stopTrack`, `setTrackVolume { volume }`

- [ ] **Step 1: Tests que fallan**: OGG y MP3-ID3 aceptados, un `.mp3` que es texto rechazado; `playTrack` fija `startedAt` al `now` del reducer; `removeTrack` del que suena detiene; jugador → `notGameMaster`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** `git commit -m "feat: audio uploads and playlist state"`

### Task 7.2: Reproductor

**Files:** Create `apps/web/src/components/audio/AudioPlayer.tsx`, `apps/web/src/state/audioSync.ts` · Modify `GMPanel.tsx`, `storage.ts`, i18n · Test `apps/web/test/audioSync.test.ts`

**Interfaces — Produces:** `offsetSeconds(playing, nowMs: number, durationSec: number): number | null` — `loop` → `((now − startedAt)/1000) % duration`; sin loop y ya terminó → `null`.

- [ ] **Step 1:** Tests de `offsetSeconds` (loop, sin loop en curso, sin loop terminado, `startedAt` en el futuro por reloj desfasado → 0).
- [ ] **Step 2:** FAIL. **Step 3:** Un `<audio>` por pestaña; al cambiar `playing` o al cargar metadata, `currentTime = offsetSeconds(...)`. `play()` rechazado (autoplay) → botón visible "Activar sonido" que reintenta. Volumen local (multiplica el del GM) en `localStorage` con Zod. Lista de pistas + subir + play/stop en `GMPanel`.
- [ ] **Step 4:** PASS. **Step 5:** Prueba manual con dos navegadores; `git commit -m "feat(web): synced playlist player"`

---

## Fase 8 — Tablas aleatorias

### Task 8.1: Tablas del GM

**Files:** Create `packages/protocol/src/tables.ts` · Modify `room.ts`, `events.ts`, `rollLog.ts`, `GMPanel.tsx`, i18n · Test `packages/protocol/test/tables.test.ts`

**Interfaces — Produces:**
- `RollTableSchema = z.object({ id, name: z.string().min(1).max(60), rows: z.array(z.string().min(1).max(200)).min(1).max(100) })`; `RoomState.tables` `.max(30).default([])`, GM-only (`roomForRole('player')` → `[]`)
- Intents GM-only: `upsertTable { table }`, `removeTable { id }`, `rollTable { tableId, visibility }`
- `RollEntry` gana `{ kind: 'table', id, at, by, label: string /* nombre de tabla */, result: string, index: z.number().int() }`

- [ ] **Step 1: Tests que fallan**: con `seededRng(1)` la fila elegida es estable; `visibility: 'private'` → a `privateLog`; jugador no ve `tables`; `rollTable` incrementa `rollCount` (test en server, ya cubierto por Task 0.1).
- [ ] **Step 2:** FAIL. **Step 3:** Índice = `Math.floor(rng() * rows.length)`. Editor simple en GMPanel: nombre + textarea, una fila por línea. **Step 4:** PASS. **Step 5:** `git commit -m "feat: GM random tables"`

---

## Fase 9 — Regiones

La más grande; hacer al final. Reutiliza la herramienta de polígono del lápiz de niebla.

### Task 9.1: Modelo y disparo al entrar

**Files:** Create `packages/protocol/src/regions.ts` · Modify `map.ts` (`SceneSchema`, `mapForPlayer`), `room.ts` (caso `moveToken`), `events.ts` · Test `packages/protocol/test/regions.test.ts`

**Interfaces — Produces:**
- `RegionSchema = z.object({ id, name: z.string().min(1).max(60), points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(64), effect: z.enum(['difficultTerrain', 'hazard', 'note']), text: z.string().max(500), visibleToPlayers: z.boolean() })`
- `SceneSchema.regions: z.array(RegionSchema).max(50).default([])`
- `pointInPolygon(p: {x,y}, polygon: readonly {x,y}[]): boolean` (ray casting, borde cuenta como dentro)
- `regionsEntered(before: Token, after: Token, regions: readonly Region[]): Region[]` — centro del token fuera antes y dentro después
- Intents GM-only: `upsertRegion { sceneId, region }`, `removeRegion { sceneId, regionId }`

- [ ] **Step 1: Tests que fallan**: `pointInPolygon` (cuadrado, cóncava en "L", punto en borde); `regionsEntered` no dispara si ya estaba dentro; `moveToken` con `commit: true` que entra a un `hazard` agrega a `privateLog` un `message` con audiencia `[]` (solo GM) "«Token» entró en «Región»: texto"; con `commit: false` no dispara; `mapForPlayer` quita regiones `visibleToPlayers: false`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; el aviso usa `logEntries` de Fase 1. **Step 4:** PASS. **Step 5:** `git commit -m "feat(protocol): scene regions with enter triggers"`

### Task 9.2: Herramienta de región

**Files:** Modify `MapCanvas.tsx`, `GMPanel.tsx`, i18n

- [ ] Modo "Región" en la barra del GM: clics agregan vértices, doble clic cierra, popover con nombre/efecto/texto/visible. Relleno semitransparente por efecto (terreno difícil = rayado). Jugador ve solo las visibles, sin texto si `effect: 'hazard'`.
- [ ] Prueba manual; `git commit -m "feat(web): draw regions on the map"`

---

## Orden y tamaño

| Fase | Qué | Tam. | Depende de |
|---|---|---|---|
| 0 | `rollCount` para toda tirada | S | — |
| 1 | Chat + privados | M | 0 |
| 2 | Objetivos | M | 1 (log), 2.3 crea `colorFor` |
| 3 | Dados 3D | S | 1 (`privateRolled`) |
| 4 | Barra rápida | S | — |
| 5 | Pings | S | 2.3 (`colorFor`) |
| 6 | Diario + notas | M | — |
| 7 | Audio | M | — |
| 8 | Tablas | S | 0, 1 |
| 9 | Regiones | L | 1 |

Fases 4, 6 y 7 son independientes y pueden ir en paralelo con las demás.

## Fuera de alcance (decidido)

- Tiradas "ciegas"/"solo yo": Hope/Fear se mueven en público, ocultarlas al tirador confunde.
- Difficulty oculta al jugador al tirar contra objetivo: requiere separar `rolled` por canal.
- Compartir diario con un jugador concreto, markdown, carpetas.
- Grid hexagonal (T10), iluminación con niveles (T8), card stacks: ya contemplados en `plan-mejoras.md` o cubiertos por recall/vault.
- Todo lo exclusivo de D&D visto en el mundo analizado (importadores 5e, generador de tiendas/NPC, plutonium).
