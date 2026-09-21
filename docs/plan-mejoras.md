# Plan de mejora — Dual VTT

Fecha: 2026-09-21. Base auditada: `main` en `7ab3bdb`. Typecheck limpio, 180 tests verdes.
Hallazgos citados con `archivo:línea`; los marcados **[verificado]** se confirmaron leyendo el código a mano, el resto viene de la auditoría por área y debe releerse antes de tocar.

Tamaños: **S** < medio día · **M** 1–2 días · **L** 3+ días.

## Estado al 2026-09-21

Rama `fix/fase-1-criticos`, 22 commits, typecheck limpio y 562 tests verdes (eran 180).

- **Fase 1 completa**: S1–S10, R1–R10, W1–W12 y los tests de 1.4.
- **Track Marca completo**: B1–B5, y la atribución ya nombra el SRD 2.0.
- **Track SRD 2.0 completo salvo mecánicas nuevas**: D1–D7 y D10–D11 hechos; de D8 entraron las reglas que rompían.
- **Fase 3 en marcha**: hechos M1 descansos, M2 condiciones, M3 death moves, M4 tiradas de adversario, M5 features de adversario, M7 tiradas de reacción, M9 equipo cambiable, M11 level-up y N1 transformaciones. Quedan M6, M8, M10, M12–M14 y N2–N6.

Lo hecho de Fase 3, en detalle:

| # | Qué entró |
|---|---|
| M1 ✅ | Descansos corto y largo abiertos por el GM, con su coste en Miedo (1d4 · 1d4+PJs), cadencia de tres cortos, y dos movimientos de tiempo libre por personaje que pueden apuntar a un aliado. Recuperar carta gratis lo decide ahora el servidor. |
| M2 ✅ | Condiciones persistentes en la hoja (Oculto, Inmovilizado, Vulnerable y las que inventen las features) y visibles sobre la ficha del mapa. Vulnerable por Estrés lleno sigue derivado. |
| M3 ✅ | Los tres movimientos de muerte resueltos de verdad: cicatrices que tachan ranuras de Esperanza, inconsciencia que se cura al sanar o al descansar largo, y Arriesgarlo Todo tirado en el servidor y registrado en el log. |
| M4 ✅ | El GM tira d20 por sus adversarios contra la Evasión del objetivo, con ventaja/desventaja, Experiencia por 1 Miedo y crítico en 20 natural. El daño usa los dados del stat block. Todo al log compartido. |
| M5 ✅ | Features del stat block usables desde el panel: gastan el Miedo que pide su texto, y las Evoluciones son de un solo uso por adversario. |
| M7 ✅ | Tiradas de reacción: `resolveReactionRoll` existía sin usarse, así que esquivar entregaba al GM un Miedo que no le tocaba. |
| M9 ✅ | Cambiar armadura recalcula Puntaje y umbrales; cambiar arma cuesta un Estrés fuera de descanso y nada durante uno; una combinación que pide más manos se rechaza. |
| M11 ✅ | Las dos opciones de subida que no hacían nada: carta de dominio adicional y mejora de subclase (fundación → especialización → maestría), excluyente con multiclase. |
| N1 ✅ | Las seis transformaciones del 2.0, extraídas, en la hoja (una por personaje, fuera del loadout) y en el compendio. |

Contenido migrado, todo por extracción y verificado reproduciendo los datos 1.0:

| Archivo | 1.0 | 2.0 | Reproducen exacto |
|---|---|---|---|
| clases / subclases | 9 / 18 | 13 / 26 | 7 de 9 · 16 de 18 |
| cartas de dominio | 189 | 210 | 186 de 189 |
| ancestros / comunidades | 18 / 9 | 24 / 15 | 18 de 18 · 9 de 9 |
| adversarios / entornos | 129 / 19 | 264 / 47 | 129 de 129 · 19 de 19 |
| armas / armaduras | 204 / 34 | 315 / 69 | 194 de 195 · 34 de 34 |
| loot / consumibles | 60 / 60 | 120 / 120 | 60 de 60 cada uno |

Las diferencias que quedan están explicadas una por una: texto impreso que los datos escritos a mano omitían, tipografía que el 2.0 cambió, y tres sitios donde el dato viejo se había tragado texto del capítulo siguiente y ahora se corta.

Decisiones tomadas al implementar, distintas del plan original:

- **Estrés como coste** (movimiento bloqueado con el track lleno) no se implementó: hoy no hay ningún movimiento con coste de Estrés salvo recuperar cartas, que ya lo verifica. Entra con M8 (features de Esperanza), que es cuando aparecen los consumidores.
- **Armas y armaduras pasaron de transcripción a extracción**: a 315 filas ya no eran transcribibles a mano. `gen-equipment.mjs` y `gen-heritage.mjs` son nuevos; `gen-weapons.mjs` y `gen-armor.mjs` se borraron.
- **Glosario español normalizado** donde había derivado: «Tirada de Lanzamiento» y no «de Conjuro», «Conocimiento» y no «Saber» para el rasgo Knowledge, «movimiento de muerte» y no «tirada de muerte» porque es lo que dice la interfaz, una sola forma de «downtime move», y «escalón» para *tier* en lugar de «nivel», que se confundía con *level*.
- **La silla de combate es arma primaria**, no una categoría propia: el SRD dice que se equipa en esa ranura.

---

## 0. Diagnóstico en una pantalla

Lo que está bien y no hay que tocar:

- Arquitectura por capas y las invariantes de CLAUDE.md se cumplen. Servidor autoritativo, tiradas con semilla, `roomForRole` filtra mapa, uploads por magic bytes.
- `tokens.css` es sólido (tres alturas, contraste documentado, reduced-motion). La dirección "bronce sobre obsidiana" ya está aplicada en fases 1–3.
- i18n completa y sin claves huérfanas. `passwords.ts` usa scrypt + salt + `timingSafeEqual`.
- Dockerfile y compose existen.

Dónde se cae:

1. **Seguridad de borde**: `POST /uploads` no exige sesión **[verificado]**; login sin rate limit; sesiones sin expiración.
2. **Feedback al jugador en modo campaña**: sin indicador de conexión, death move y toasts de efecto solo funcionan offline **[verificado]**.
3. **Mecánicas SRD a medias**: sin descansos, sin condiciones persistentes, sin daño masivo **[verificado]**, adversarios son solo contadores, GM tira dados fuera de la app.
4. **SRD desactualizado**: el juego pasó a SRD 2.0 (13 clases, 10 dominios, ~270 adversarios, transformaciones) y cambiaron 4 reglas que el código aplica mal. Ver Track SRD 2.0.
5. **Mapa**: pincel de niebla no pinta arrastrando **[verificado]**, puertas no revelan visión **[verificado]**, sin regla para jugadores, sin ping, sin táctil.
6. **Deuda de tests**: `applyRoomEvent` (753 líneas) sin suite propia; `gateway.ts`, `main.ts`, rutas de `uploads.ts` sin cobertura.

---

## Track SRD 2.0 — actualización de reglas y contenido (Hope & Fear)

Fuente: `DH_SRD_2_2026_08_25.pdf` (224 págs, ya ignorado por `*.pdf` en `.gitignore`). Licencia DPCGL 2.0 del 26-08-2026 cubre SRD 2.0 y "Daggerheart: Hope & Fear".

### Qué cambia en reglas (verificado contra el PDF)

| Regla | SRD 2.0 | Código hoy | Impacto |
|---|---|---|---|
| Miedo inicial | "You start a campaign with 1 Fear per PC" (p87) | `fear: 0` en `room.ts:124` | rompe estado inicial. Setear al crear campaña o al primer `joinCampaign` con N jugadores. |
| Un solo dado de ventaja | "a player never rolls more than one advantage or disadvantage die" (p49) | `duality.ts:82` tira N d6 y toma el mayor | rompe probabilidad. Cancelar 1:1 y tirar máximo un d6. Excepción: Help an Ally. |
| Movimientos con coste de Estrés | No se puede usar un movimiento que exija marcar Estrés si está todo marcado (p50) | `markStress` sustituye siempre 1 PV (`resources.ts:39`) | rompe costes de features. Separar "marcar Estrés como daño" de "pagar Estrés". |
| Daño masivo | Ahora regla **opcional**: 2× severo → 4 PV (p50) | tope 3 | toggle por campaña; ajusta R1 de Fase 1. |
| Daño simultáneo | Fuentes simultáneas se suman antes de comparar umbrales (p51) | `applyDamage` recibe un solo `incoming` | aditivo: helper de agregación. |
| Descansos | 3 cortos seguidos → el siguiente es largo; interrumpido corto = nada, largo = beneficios de corto; GM gana 1d4 (corto) / 1d4+PJs (largo) de Miedo (p52, p87) | no existe descanso | absorbe M1 de Fase 3 con estas reglas. |
| Ataques del GM | d20, crit natural 20 = éxito + daño extra sin tocar modificador plano; ventaja = d20 extra, mayor (p86, p90) | no hay tiradas de adversario | absorbe M4. |
| Armadura y equipo | Slots por armadura, no se lleva armadura en inventario; swap de arma en descanso gratis, si no marca Estrés; arrojar arma = Finesse a Muy Cerca (p55) | `armorScore` congelado en creación | absorbe M9. |
| Consumibles | Máximo 5 de cada uno (p80) | inventario texto libre | con M10. |
| Desarmado | Fuerza o Finesse, [Proficiency]d4 (p50) | sin perfil | S. |
| Daño por Spellcast | dados = valor del rasgo Spellcast; ≤0 no tira (p50) | sin camino | S. |
| Dominios | "two of the ten domains" (p6) | 9 en JSON | rompe validación de las 4 clases nuevas. |

Sin cambios (no volver a revisar): tabla de dualidad y críticos, daño crítico, umbrales y Armor Score, resistencias, topes de Esperanza/Miedo/PV, countdowns y tabla dinámica, bandas de rango, loadout 5, level-up completo, oro, herencia mixta y carga de armas.

### Mecánicas nuevas sin equivalente

| # | Mecánica | Spec en una línea | Host | Tam. |
|---|---|---|---|---|
| N1 | **Transformaciones** (p42–45) | 6 cartas (Demigod, Ghost, Reanimated, Shapeshifter, Vampire, Werewolf); beneficio + inconveniente; una por PJ; no cuenta en loadout. | `srd-data/transformations.json`, `sheet.ts` campo `transformation`, `loadout.ts:2` | M |
| N2 | **Battle Points** (p94) | `(3 × PJs) + 2`; ajustes −1/−2/+1/+2; costes Minion 1 (grupo = PJs), Social/Support 1, Horde/Ranged/Skulk/Standard 2, Leader 3, Bruiser 4, Solo 5. | `rules/src/encounter.ts` + GMPanel (T5 de Fase 4) | M |
| N3 | **Spotlight Tracker** opcional (p47) | N fichas por jugador (rec. 3), una por acción, recarga cuando todos en 0. | `room.ts:103` slice `spotlightTokens` | S |
| N4 | **Evoluciones y Pools de adversario** (p94) | feature `Evolution:` de un uso por escena; pools de fichas compartidos por escena. | schema `StatBlockFeature.kind`, `room.ts` adversaryInstances | S |
| N5 | Caídas/colisión, bajo el agua, PJ vs PJ, tiradas de destino (p92) | tablas fijas; countdown de aire (3); ataque vs Evasión. | `rules/src/hazards.ts`, ayuda | S |
| N6 | Presupuesto de Miedo por escena (p88) | Incidental 0–1 … Climática 6–12. Solo texto de ayuda para el GM. | `i18n` | S |
| N7 | Mecánicas suplementarias (p190–205) | Facciones, Feasts, Grimdark, Tech, Western, Colossal, Fairy Tale, Monster Hunting, Hex Crawl. **No implementar**: son marcos opcionales; a lo sumo compendio. | — | — |

### Contenido a agregar (delta 1.0 → 2.0)

| Archivo | Hoy | 2.0 | Nuevo |
|---|---|---|---|
| domains | 9 | 10 | Dread |
| classes | 9 | 13 | Assassin, Brawler, Warlock, Witch |
| subclasses | 18 | 26 | Executioners/Poisoners Guild, Juggernaut/Martial Artist, Pact of the Endless/Wrathful, Hedge/Moon |
| domain-cards | 189 | 210 | 21 de Dread. Revisar "Forest Sprites" (título a dos líneas). Textos de las 189 existentes pueden haber cambiado: re-extraer todo. |
| ancestries | 18 | 22 | Elemental Kin: Earthkin, Emberkin, Skykin, Tidekin |
| communities | 9 | 14 | Duneborne, Frostborne, Hearthborne, Reborne, Warborne |
| transformations | — | 6 | archivo nuevo |
| beastforms | 24 | 24 | sin cambios |
| adversaries | 129 | ~270 | +141; feature kind `Evolution`; nombres con `:` (Fallen Warlord: Realm-Breaker), `Corrupter`→`Corruptor` |
| environments | 19 | 47 | +28; campos idénticos |
| weapons | 204 | 303 + 12 | +99; **Combat Wheelchair** (p70) como tabla con columna Tier |
| armor | 34 | ~69 | +35 |
| loot / consumables | 60 / 60 | 120 / 120 | segunda tabla "Additional"; ids colisionan 01–60 → prefijo por tabla |

Brawler trae tabla de "martial stances" por tier sin análogo actual.

### Plan de migración (orden)

| # | Paso | Notas | Tam. |
|---|---|---|---|
| D1 ✅ | `pdftotext -bbox-layout` del 2.0 y actualizar `glyphs.mjs` | Añadir U+E547=7, U+E548=8, U+E549=9 (verificados en `Minion (7)`, `Horde (8/HP)`, `Minion (9)`). Sin esto `assertNoPua` lanza. | S |
| D2 ✅ | Reescribir `gen-cards.mjs` contra el apéndice p206–224 | Formato plano: `TITLE / Level N Domain Type / Recall Cost: N / texto`. 10×21. Mucho más fiable que la extracción actual. | S |
| D3 ✅ | `gen-adversaries.mjs`: nuevo rango de páginas, regex `Action\|Reaction\|Passive\|Evolution`, slugs con `:` | Añadir `kind: 'evolution'` al schema. | S |
| D4 ✅ | `gen-environments.mjs`, `gen-loot.mjs` (dos tablas por sección, id con prefijo `core-`/`additional-`) | | S |
| D5 ✅ | Transcribir a mano weapons (+99), wheelchair (+12), armor (+35) | Scripts inline. Tedioso, no técnico. | M |
| D6 ✅ | JSON manuales: 4 clases, 8 subclases, Dread, 4 ancestros, 5 comunidades, 6 transformaciones + `gen-transformations.mjs` o a mano | Añadir `transformations` a `schemas`, `fileNames`, ambos `raw`. Brawler: campo `stances`. | M |
| D7 ✅ | Traducción `es/` de todo lo nuevo con paridad de ids | Test de paridad ya existe y fallará hasta completar. Volumen grande (≈+400 entradas). | L |
| D8 | Reglas: Miedo inicial, un dado de ventaja, Estrés como coste, daño masivo opcional, Spellcast/desarmado | Tests primero en `rules`. | M |
| D9 | Transformaciones en hoja y wizard (paso opcional del GM) | N1. | M |
| D10 ✅ | Primer de reglas en `en.ts`/`es.ts`: corregir Hidden (desventaja contra el objetivo, p52), descansos (3 cortos → largo, interrupción, Miedo del GM), Miedo inicial, Estrés bloqueante; todas las páginas citadas pasan de 1.0 a 2.0 (47–54, 72). | `help.rules.*` | S |
| D11 ✅ | `NOTICE.md`, README y pantalla de ayuda: aviso de SRD 2.0 con el texto exacto de la licencia (ver Track Marca). | | S |

**Excluir de la extracción**: el Witherwild Campaign Frame (p184–189). DPCGL §1.9.3: los Campaign Frames solo pueden compartirse en actual play; no se pueden republicar ni adaptar.

---

## Track Marca — logos Darrington y licencia

Pack: `Darrington-Press-Community-Content-Logos.zip` (sin commitear). Contiene lockup "Daggerheart Compatible" (SVG y PNG 2662×649 en full color, blanco, negro, blanco+color) e icono de la botella de alquimia (PNG 288×328, 5 variantes). Sin README de uso dentro del zip; las reglas están en la DPCGL.

Qué dice la DPCGL 2.0 (leída del PDF oficial):

- §2.5 Name Marks: "Daggerheart" no puede ir en el título ni en la portada; en texto de marketing debe ir junto a "Compatible". **"Dual VTT" cumple.** Escribir siempre "Daggerheart™ Compatible" o "compatible con Daggerheart™".
- §4.1 Atribución no comercial: aviso de copyright, atribución, enlace al contenido, enlace a la licencia, y **declaración de si se modificó** el contenido. La traducción al español es una modificación: hay que declararla.
- §4.2 Logo: obligatorio solo en material comercial. Para uso gratuito es permitido, no exigido. Usar el lockup con la botella para Daggerheart.
- §4.3 Texto exacto sugerido por la licencia para 2.0: *"This product includes materials from the Daggerheart System Reference Document 2.0, © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at https://www.daggerheart.com. There are no previous modifications by others."*
- §2.3 Sin endoso: no implicar aprobación de Darrington. Mantener el disclaimer actual de NOTICE.

| # | Acción | Tam. |
|---|---|---|
| B1 ✅ | Copiar solo lo necesario a `apps/web/public/images/brand/`: `DH_CGL_logos_final_white_full_color.svg` (fondo oscuro) y un PNG del icono. Ignorar `__MACOSX`, `.DS_Store`, el zip y la carpeta descomprimida en `.gitignore`. | S |
| B2 ✅ | Lockup "Daggerheart Compatible" en pie del login (`LoginRoute.tsx:28`) y en pestaña Ayuda → "Acerca de" con el texto §4.3 completo, enlace a licencia y declaración de traducción. | S |
| B3 ✅ | **No** usar la botella como favicon ni como logo principal de la app. El favicon sigue siendo propio; el mark de Darrington acompaña, no titula (§2.5). | — |
| B4 ✅ | Actualizar `NOTICE.md` y README: SRD 1.0 → 2.0, texto §4.3, "Daggerheart™ Compatible" en la primera línea del README, declaración de modificación (traducción es). Hoy dicen "DPCG"; la licencia se llama DPCGL. | S |
| B5 ✅ | Hoja imprimible: pie "Daggerheart™ Compatible. Terms at Daggerheart.com" (formato que la licencia pide para cartas/adversarios impresos, §4.2.f.iii; opcional en no comercial pero barato). | S |

**Riesgo a decidir por vos, no cambia con 2.0**: §1.9(d) limita "compartir" contenido SRD en VTTs a la lista blanca (Roll20, Demiplane, Foundry, Alchemy, Fantasy Grounds); §1.8 exime el juego privado entre amigos. La cláusula ya existía en la DPCGL de julio 2025 bajo la que se publicó el repo. Un repo público con el SRD en JSON es "digital print" del contenido, permitido; que el software sea un VTT auto-hospedado no listado es zona gris. Opciones: mantener como está (uso privado, no comercial, sin monetizar), o escribir a Darrington pidiendo aprobación escrita (§1.9.1 lo contempla). No es algo que el código pueda resolver.

**Decisión (2026-09-21)**: seguir como está. El uso es juego privado entre amigos en servidor propio (§1.8 exime), sin cobro ni monetización. Lo que depende del proyecto queda cubierto con B1–B5 y la exclusión del Campaign Frame. No se pide aprobación escrita.

---

## Fase 1 — Fixes críticos (1 semana)

Primero lo que rompe partidas o expone el servidor. Nada de features.

### 1.1 Servidor

| # | Hallazgo | Archivo | Tam. |
|---|---|---|---|
| S1 ✅ | `POST /uploads` sin auth ni asociación a campaña **[verificado]**. Exigir sesión (miembro o GM), guardar `campaignId` en el nombre o índice. | `apps/server/src/uploads.ts:99`, `main.ts:99` | S |
| S2 ✅ | Snapshots comparten `${path}.tmp`; escrituras concurrentes (intervalo + `claimCharacter` + HTTP) pueden intercalarse **[verificado]**. Cola serializada o tmp único por escritura. Mismo patrón en `users-snapshot.ts`. | `campaigns-snapshot.ts:34`, `users-snapshot.ts:28` | S |
| S3 ✅ | Login sin rate limit ni lockout; `password.min(1)`. Contador por IP+usuario en memoria, 5 fallos → 60 s. | `auth-http.ts:67`, `protocol/src/auth.ts:20` | S |
| S4 ✅ | Sesiones sin TTL ni cap; cambiar contraseña no invalida tokens. TTL deslizante 30 días, `destroyAllFor(userId)` en reset/cambio. | `sessions.ts:9`, `auth-http.ts:116,178` | S |
| S5 ✅ | Timing leak en usuario inexistente: verificar contra hash dummy en el camino de fallo. | `users.ts:60` | S |
| S6 ✅ | Shutdown parcial: no vuelca `users`, no espera `http.close()`, segunda señal reentra. | `main.ts:118` | S |
| S7 ✅ | Cadena `void handler().then(...)` sin `.catch`: un throw fuera del try deja el socket colgado. | `main.ts:92` | S |
| S8 ✅ | `tunnel.ts`: `spawnSync` del build bloquea el event loop con la mesa en vivo; en fallo deja `this.tunnel` seteado y fuga cloudflared. | `tunnel.ts:52,80` | S |
| S9 ✅ | Carrera de username duplicado (check → hash 100 ms → insert). Reservar nombre antes de hashear. | `auth-http.ts:151`, `users.ts:51` | S |
| S10 ✅ | `joinCampaign` emite `{players: undefined}` en canal combinado si la campaña desapareció. | `gateway.ts:121` | S |

### 1.2 Reglas y protocolo

| # | Hallazgo | Archivo | Tam. |
|---|---|---|---|
| R1 ✅ | Daño masivo (2× severo → 4 PV) ausente **[verificado]**. En SRD 2.0 es regla opcional: implementar como toggle de campaña, apagado por defecto. | `rules/src/damage.ts:166` | S |
| R2 ✅ | PV/estrés de adversarios llegan a jugadores: `roomForRole` solo filtra `map` **[verificado]**. Filtrar `adversaryInstances` a `{instanceId, name}`. | `protocol/src/room.ts:139` | S |
| R3 ✅ | "Intents, not results" roto: cliente envía `recallCost`, `proficiency` y `experience.modifier` sin cota **[verificado parcial]**. Leerlos de la hoja en el servidor. | `events.ts:75,109,121` | S |
| R4 ✅ | `markHP` con `amount 0` y PV llenos devuelve `deathMoveRequired`. | `rules/src/resources.ts:258` | S |
| R5 ✅ | `updateAdversary` no acota al `hp` del stat block. | `room.ts:410` | S |
| R6 ✅ | `advanceCountdown` manual no salta los ya `triggered`. | `room.ts:306` | S |
| R7 ✅ | Unicidad de `token.id` por escena. Nota: `refId === actor.id` **no era un bug**: en una sala los personajes se indexan por id de cuenta, así que ese es su id de personaje. Se corrigió el comentario del schema, no la lógica. | `room.ts:371` | S |
| R8 ✅ | `armorSlotsToMark` sin límite de 1 por ataque. | `sheet.ts:270` | S |
| R9 ✅ | Puertas: `addWall/updateWall/removeWall` no llaman `revealVisionFor` **[verificado]**. Abrir puerta en modo auto no revela nada. | `room.ts:710` | S |
| R10 ✅ | Visión auto sin imagen: bounds `{0,0}` colapsan el polígono. | `room.ts:207` | S |

### 1.3 Web

| # | Hallazgo | Archivo | Tam. |
|---|---|---|---|
| W1 ✅ | Online, `run()` retorna antes de `describeEffect` / `deathMoveRequired` **[verificado]**: death move nunca aparece en campaña, ni los toasts de efecto. Derivar del `roomPatch` (comparar PV antes/después) o que el servidor emita `effect` junto al patch. | `SheetRoute.tsx:110` | M |
| W2 ✅ | `status` de `useCampaign` no lo consume nadie **[verificado]**. Banner "reconectando" + deshabilitar controles que envían intents. | `useCampaign.ts:74`, `App.tsx` | S |
| W3 ✅ | Pincel de niebla solo pinta en clic **[verificado]**: el guard en `onStagePointerMove` retorna siempre y no hay llamada a pintar. Pintar en move con throttle. | `MapCanvas.tsx:181` | S |
| W4 ✅ | Token fantasma: drag imperativo en Konva; si el servidor rechaza, el nodo queda donde se soltó. Resetear `x/y` desde props en `onDragEnd`. | `MapCanvas.tsx:459` | S |
| W5 ✅ | `RollDialog` dificultad sin clamp → `NaN` en la tirada y el log. | `RollDialog.tsx:457` | S |
| W6 ✅ | Borrador de wizard que no deserializa se sobreescribe en silencio. Versionar clave y avisar. | `storage.ts:651`, `useCreation.ts:494` | S |
| W7 ✅ | Resultados de `createCampaign`/`addPlayer` descartados; agregar usuario inexistente parece éxito. | `App.tsx:227`, `CampaignsRoute.tsx:64` | S |
| W8 ✅ | Doble `joinCampaign` en primer connect; `roomPatch` antes de `roomState` se descarta sin resync. | `useCampaign.ts:111,136,222` | S |
| W9 ✅ | Popover de token congelado durante pan; sin clamp a viewport. | `MapCanvas.tsx:218`, `MapRoute.tsx:341` | S |
| W10 ✅ | Botón de anillos de rango visible para jugador pero `updateToken` es GM-only → falla mudo. Ocultar o abrir evento `setMyTokenRings`. | `MapRoute.tsx`, `room.ts:664` | S |
| W11 ✅ | `LevelUpDialog`: `toggleIn` descarta la selección más vieja sin aviso; confirm habilitado con `traits` y 0 rasgos. | `LevelUpDialog.tsx:170,261` | S |
| W12 ✅ | `PlayersRoute` sin abort ni refresh tras reset; `window.prompt` para reset de contraseña. | `PlayersRoute.tsx:20,46` | S |

### 1.4 Tests que faltan para no regresar

- ✅ `packages/protocol/test/room.test.ts`: permisos por rol, oro, cartas, level-up, tiradas, countdowns, tokens, muros, visión por puerta, `roomForRole`.
- ✅ `apps/server/test/hardening.test.ts`: auth de uploads, traversal, rate limit, TTL de sesión, carrera de usuario, escritura atómica concurrente.
- ✅ `rules/test/damage.test.ts`: daño masivo. `rules/test/duality.test.ts`: tope de un dado y Ayudar a un Aliado.
- Pendiente: `apps/server/test/gateway.test.ts` (mensaje sobredimensionado, doble join en el socket).

---

## Fase 2 — Usabilidad (1–2 semanas)

Lo que hace que la mesa fluya sin tocar reglas nuevas.

| # | Mejora | Dónde | Tam. |
|---|---|---|---|
| U1 | **Miedo visible para jugadores**: `room.fear` ya viaja; falta renderizarlo en HUD del mapa y hoja. | `MapRoute.tsx`, `SheetRoute.tsx` | S |
| U2 | **Spotlight visible**: anillo dorado en token, cue "te toca" en hoja del jugador. | `MapCanvas.tsx`, `SheetRoute.tsx` | S |
| U3 | **Vista de grupo para jugadores**: `room.characters` ya llega; tarjetas compactas PV/estrés/esperanza de compañeros. | nuevo `PartyStrip.tsx` | S |
| U4 | **Confirmación en acciones destructivas**: salir de campaña, empezar de nuevo, reset de contraseña, guardar carta en bóveda. Un `ConfirmDialog` reutilizando `Dialog.tsx`. | `App.tsx:218`, `WizardRoute.tsx:114`, `PlayersRoute.tsx:45` | S |
| U5 | **Formularios reales** (`<form>` + `autoComplete`): login, cambio de contraseña (con confirmación y largo mínimo), campañas, jugadores. Enter envía. | rutas auth/campaigns | S |
| U6 | **Dialog accesible**: focus trap, restaurar foco al cerrar, `aria-labelledby`, Esc solo cierra el de arriba. | `Dialog.tsx:15` | S |
| U7 | **Toasts apilables** con pausa en hover; rechazos con `role="alert"`. | `Toast.tsx`, `App.tsx:164` | S |
| U8 | **Estados de carga/vacío**: `PlayersRoute`, pantalla de auth, lista de campañas vacía. | varios | S |
| U9 | **Mapa: fit-to-screen, centrar en mi token, atajos de teclado** (Esc deselecciona, Supr borra, F ajusta, +/- zoom). Todo estado local de `view`. | `MapCanvas.tsx:83` | S |
| U10 | **Regla de medir para jugadores** (hoy GM-only por gate de UI). | `MapRoute.tsx:286` | S |
| U11 | **Colocar mi token donde clico**, no en (200,200); permitir recolocar si el GM lo borró o cambió escena. | `MapRoute.tsx:269` | S |
| U12 | **Snap-to-grid opcional** y consciente del tamaño del token. | `gridSnap.ts:366` | S |
| U13 | **Countdowns**: +1/−1, fijar valor, reiniciar, disparar ahora. | `GMPanel.tsx:180` | S |
| U14 | **Adversarios**: cantidad al añadir, numeración "Guardia A/B", duplicar, y que añadir desde el panel coloque token (unificar con búsqueda de `MapRoute.tsx:773`). | `GMPanel.tsx:311` | M |
| U15 | **Panel GM junto al mapa**: hoy son rutas separadas. Convertir GMPanel en panel flotante del mapa (ya existe `FloatingPanel.tsx`). | `MapRoute.tsx`, `GMPanel.tsx` | M |
| U16 | **Roll log**: filtro por jugador/tipo/resultado, hora, colapsar. | `RollLogPanel.tsx` | S |
| U17 | **Responsive**: reglas para `.topbar` (overflow), `.steps` (9 pips), `.card-head`, `.help-tabs`. Sin cambiar layout de escritorio. | `app.css` | M |
| U18 | **Táctil en mapa**: pinch-zoom y pan con un dedo (Konva soporta `touch*`). | `MapCanvas.tsx` | M |
| U19 | **Wizard**: paso de resumen antes de finalizar; aviso al saltar a un paso inválido desde los pips. | `WizardRoute.tsx:170` | S |
| U20 | **Compendio**: búsqueda unificada con las otras pestañas; enlace desde rasgos/cartas de la hoja a su entrada. | `HelpRoute.tsx:86`, `Compendium.tsx:149` | S |
| U21 | **Pluralización** en `t()`: soporte `{count, plural, one{} other{}}` o claves `_one/_other`. Arreglar `jugador(es)`, `ranura(s)`, `carta(s)`, `fichas`. | `i18n/index.ts:597` | S |

---

## Fase 3 — Mecánicas SRD que faltan (3–4 semanas)

Orden por impacto en una sesión real. Cada una entra por `applyRoomEvent`, con reducer puro en `rules` y test antes que UI.

| # | Mecánica | Host | Tam. |
|---|---|---|---|
| M1 ✅ | **Descansos**: corto/largo, movimientos de downtime (curar PV, limpiar estrés, reparar armadura, preparar, proyecto). Evento `rest {kind, moves[]}` por personaje; GM dispara `partyRest` que además avanza countdowns (ya existe `advanceCountdownsForRest`). Hoy solo hay un toggle "descansando" para cartas. | nuevo `rules/src/rest.ts`, `events.ts`, botón en GMPanel y hoja | L |
| M2 ✅ | **Condiciones persistentes**: Vulnerable / Oculto / Inmovilizado + libres. `conditions: string[]` en `SheetStateSchema` y en `TokenSchema`; badges en token y hoja; Vulnerable dobla... nada mecánico automático, solo visible. | `sheet.ts:50`, `map.ts:13`, `MapCanvas.tsx` | M |
| M3 ✅ | **Death moves reales**: `DeathMoveDialog` hoy no envía intent. Evento `deathMove {choice}`; Blaze of Glory / Avoid Death (cicatriz: −1 slot de Esperanza) / Risk It All (tirada servidor). | `rules/src/death.ts`, `sheet.ts` | M |
| M4 ✅ | **Tiradas del GM auditadas**: `rollAdversaryAttack {instanceId, targetId?}` y `rollAdversaryDamage` con `rngForRoll`; usa `attackModifier`/`standardAttack` del stat block (datos ya en JSON, nunca consumidos). Botones en la tarjeta de adversario. | `rules/src/adversary.ts`, `events.ts`, `GMPanel.tsx` | L |
| M5 | **Adversarios completos**: dificultad, umbrales, `hordeThreshold`, features con coste de Miedo (`costsFear`) como botones que gastan Miedo. | `room.ts:410`, `GMPanel.tsx:461` | M |
| M6 | **Tag team y acción de grupo**: tag team gasta 3 Esperanza y combina dos tiradas; grupo = líder + ayudantes con d6 Esperanza. Extiende `rollDuality`. | `rules/src/duality.ts`, `RollDialog.tsx` | M |
| M7 | **Tiradas de reacción**: `resolveReactionRoll` existe y no se usa. Un flag en `rollDuality`. | `sheet.ts`, `RollDialog.tsx` | S |
| M8 | **Hope features de clase** y features de ancestro/comunidad/subclase como acciones: gastar 3 Esperanza, efecto narrativo en log. Datos ya presentes (`hopeFeature`). | `sheet.ts`, `SheetRoute.tsx` | M |
| M9 | **Equipo en juego**: cambiar arma/armadura recalcula `armorScore`, umbrales y daño; hoy congelado desde creación. | `sheet.ts`, `LoadoutPanel.tsx` | M |
| M10 | **Inventario y consumibles**: de texto libre a lista con ids; pociones curan `1d4` PV/estrés vía servidor. | `finalize.ts:67`, `sheet.ts` | M |
| M11 | **Level-up completo**: `advancementsTaken` acumulado pero nunca leído (tope 3 por opción, subclase una por tier); `domainCard` extra es no-op; `subclass` no registra especialización/maestría; rasgos marcados deben limpiarse en L2 también. | `rules/src/levelUp.ts:156,214,220,255` | M |
| M12 | **Multiclase**: `multiclassCardLevelCap` sin usar, acceso a dominio no verificado. | `levelUp.ts` | S |
| M13 | **Beastforms** (Druida): esquema sin consumidores. Selector en hoja que sobrescribe rasgo/evasión/ataque temporalmente. | `rules/src/beastform.ts` | M |
| M14 | **Entornos**: mostrar dificultad, features e impulsos en panel GM; features con Miedo como en M5. | `room.ts:277`, `GMPanel.tsx` | S |
| ~~M15~~ | **No era un problema.** Son tres conceptos distintos: un tipo único para el ataque de adversario, `physicalOrMagic` para el arma que deja elegir, y `both` para el daño que es ambos a la vez. Documentado en `core.ts`. | — | — |

---

## Fase 4 — Herramientas nuevas de mesa (4+ semanas, elegir)

Cada una es un slice nuevo en `RoomStateSchema` + filtro en `roomForRole` si es GM-only. Ordenadas por valor/costo.

| # | Herramienta | Notas | Tam. |
|---|---|---|---|
| T1 | **Ping / señalar** en mapa (doble clic → pulso 2 s para todos). Slice efímero, no se snapshotea. | protocolo + canvas | S |
| T2 | **Notas de sesión del GM** (markdown, GM-only, por campaña). | slice `notes`, filtrado a jugadores | S |
| T3 | **Chat de texto** con susurro GM↔jugador y tiradas inline (`/r 2d6+1` pasa por servidor). Reutiliza `rollLog` como canal. | slice `chat` | M |
| T4 | **Capa de dibujo/anotaciones** (líneas, áreas, texto) con visibilidad GM/todos. | slice `drawings` | M |
| T5 | **Constructor de encuentros** con Battle Points del SRD (`(3 × PJs) + 2`, ajustes por tier) → añade adversarios y tokens en lote. | `rules/src/encounter.ts`, GMPanel | M |
| T6 | **Biblioteca de assets**: uploads reutilizables por campaña (portraits, mapas) con borrado; resuelve también orphans de S1. | `uploads.ts`, panel | M |
| T7 | **Undo del GM** (últimos N eventos): historial en servidor, `undo` recomputa desde snapshot previo. | `campaigns.ts`, `room.ts` | M |
| T8 | **Iluminación dinámica real**: hoy la visión solo revela y nunca oculta (`room.ts:210`). Distinguir "visible ahora" de "recordado"; ocultar tokens fuera de línea de visión. | `vision.ts`, `map.ts` | L |
| T9 | **Exportar/importar campaña y personaje** (JSON). Ruta GM `GET /campaigns/:id/export`, y botón en hoja. | `campaigns-http.ts`, `SheetRoute.tsx` | S |
| T10 | **Grid hexagonal** (`grid.mode: 'hex'`); `ranges.ts` ya separa bandas por cuadrados. | `map.ts:80`, `ranges.ts` | M |
| T11 | **Audio ambiente** por escena (URL, volumen, loop). | slice en `Scene` | S |
| T12 | **Múltiples personajes por cuenta** / co-GM (`ownerId` → `gmIds[]`). | `campaigns.ts:27`, `App.tsx:79` | M |

---

## Fase 5 — UI y dirección visual

El documento `Rediseno VTT Daggerheart - Direccion Visual.html` (sin commitear) ya define tokens y gramática; fases 1–3 están aplicadas. Queda:

| # | Mejora | Tam. |
|---|---|---|
| V1 | **Fase 4 del rediseño**: HUD del mapa con set de iconos lineales completo. Todavía hay emoji/glifos sueltos: `✕` (`Dialog.tsx:38`), `✓` (`WizardRoute.tsx:141`), `⚡` (`LoadoutPanel.tsx:327`), `☐` (`PrintableSheet.tsx:400`), `−/+` (`SheetRoute.tsx:416`), banderas (`LocaleToggle.tsx:18`). Migrar a `Icon.tsx`. | S |
| V2 | **Hoja compacta flotante v2** según mockup 05 del doc: escudos de Evasión/Armadura con `clip-path`, cinta de umbrales, "mostrar al grupo". Ya existe `MapSheetPanel.tsx`; es refinar, no rehacer. | M |
| V3 | **Limpieza de tokens**: eliminar alias duplicados (`--radius-sm`≡`--radius-chip`, `--radius-md`≡`--radius-ctl`, `--c-line-strong`→`--c-line-bronze`) y hexes crudos en `app.css:637`. | S |
| V4 | **Selectores muertos** en `app.css`: `.trait-mod`, `.join-code`, `.btn-danger`, `.map-layout`. Recuperar `.visually-hidden` (hoy sin uso, hace falta para a11y). | S |
| V5 | **Controles semánticos**: tabs de ayuda con `role=tablist`; `OptionList` single-select como radios; sustituir `title=` por tooltips visibles en touch (`LoadoutPanel.tsx:323`). | S |
| V6 | **Orden de encabezados**: `Dialog` emite `h2` dentro de páginas con `h2`; `h3` sueltos en `SheetFurniture.tsx:162`. Pasar nivel por prop. | S |
| V7 | **Tarjetas de campaña** con arte 16:9, estado "en vivo", avatares de miembros (mockup 03). Requiere `imageUrl` en campaña (T6). | M |
| V8 | **Retrato de personaje** en hoja y token (upload ya existe para tokens). | S |
| V9 | Modo claro: **no** hacerlo. `color-scheme: dark` es decisión de producto; anotar en README. | — |

---

## Fase 6 — Operación para self-hosters

| # | Mejora | Tam. |
|---|---|---|
| O1 | Borrar/archivar campaña; borrar/deshabilitar usuario (hoy acumulan para siempre). | S |
| O2 | Sesiones persistidas en `.data/sessions.json` (con TTL de S4) para que un `docker restart` no eche a la mesa. | S |
| O3 | Códigos de invitación: GM genera código, jugador se registra solo con él. Reemplaza crear cuentas a mano. | M |
| O4 | Limpieza de uploads huérfanos al arrancar (comparar `.data/uploads` con refs en snapshot). | S |
| O5 | Logs estructurados mínimos (`JSON.stringify` por línea con nivel) y `Vary: Origin` en CORS. | S |
| O6 | Documentar reverse proxy TLS (Caddy) en README; el servidor no debe hacer TLS. | S |

---

## Orden recomendado

1. **Semana 1**: Fase 1 completa (S1–S10, R1–R10, W1–W12) + tests 1.4. Son todas S salvo W1. Una PR por bloque. R1 (daño masivo) se implementa como toggle opcional según 2.0.
2. **Semana 2**: Track Marca completo (B1–B5, una tarde) + D1–D4 y D8 del Track SRD 2.0 (pipeline de extracción y las 4 reglas que rompen: Miedo inicial, un dado de ventaja, Estrés como coste, dominios = 10). Esto deja `main` correcto en reglas aunque falte contenido.
3. **Semanas 3–4**: D5–D7 contenido 2.0 (transcripción + JSON manuales + traducción). Paralelizable con U1–U16 porque no tocan los mismos archivos.
4. **Semanas 5–8**: Fase 3 con reglas 2.0: M1 descansos (con cadencia 3-cortos y Miedo del GM) → M3 death moves → M4/M5 adversarios con d20 → M2 condiciones → D9 transformaciones → M9 equipo → M11 level-up.
5. **Paralelo, cuando haya hueco**: V1, V3–V6, O1, O2, T1, T2, T9, D10, N3.
6. **Fase 4 grande** (T3 chat, T5 encuentros con Battle Points N2, T7 undo, T8 iluminación) tras una temporada jugando con lo anterior.

Regla para todo lo nuevo: reducer puro + test en `rules`/`protocol`, evento en `events.ts`, filtro en `roomForRole` si es GM-only, y recién entonces UI. Ninguna feature entra sin su fila en `room.test.ts`. Contenido nuevo entra solo por script de extracción con `problems: 0`, nunca pegado a mano en el JSON salvo weapons/armor.
