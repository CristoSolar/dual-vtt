# Exportar hoja de personaje a PDF

Fecha: 2026-08-11

## Problema

Los jugadores necesitan imprimir su hoja de personaje con un diseño casi
idéntico a la hoja oficial de Daggerheart (ver referencia adjunta en la
conversación), en español, para jugar en mesa física.

## Enfoque

Vista imprimible en el propio cliente web, apoyada en la función nativa
"Imprimir → Guardar como PDF" del navegador. Sin dependencias nuevas
(nada de `jsPDF`, `html2canvas`, ni generación en servidor con
Puppeteer/Playwright — el servidor sigue siendo solo transporte, sin lógica
de juego ni renderizado).

## Componentes

- `apps/web/src/components/sheet/PrintableSheet.tsx` — componente de
  presentación puro. Recibe `sheet: SheetState` (y deriva lo que necesite
  con `selectSheetView`, igual que `SheetRoute`). No dispara ninguna acción
  ni intent; solo lee datos.
- `apps/web/src/styles/print-sheet.css` — hoja de estilos nueva, todo
  scoped bajo `.print-sheet` para no chocar con `app.css`. Incluye:
  - `@page { size: A4; margin: 0; }`
  - Reglas `@media print` que ocultan el resto de la app y muestran solo
    el overlay `.print-sheet`.
  - En pantalla (sin imprimir), el overlay se muestra igual, a tamaño A4,
    como vista previa en vivo.
- `SheetRoute.tsx` — agrega un botón "Exportar PDF" en el header junto a
  los botones existentes ("Recibir daño", "Subir de nivel"). Al hacer
  click, muestra `PrintableSheet` en un overlay a pantalla completa. El
  overlay tiene su propio botón "Imprimir / Guardar PDF" (llama a
  `window.print()`) y un botón de cerrar (clase `no-print`, oculto al
  imprimir).

No hay cambios de ruteo (`App.tsx`) ni cambios en `CharactersRoute.tsx`.
Un único punto de entrada.

## Fidelidad visual

Reproducción con CSS + SVG inline únicamente (sin imágenes externas, sin
fuentes web):

- Banner de cabecera oscuro con esquina cortada (`clip-path`).
- Círculos-escudo para los 6 rasgos, con el modificador y ejemplos de uso
  en español (texto estático, decorativo, no viene de `srd-data`).
- Escudos de Evasión y Armadura.
- Casillas de HP/Estrés (marcadas vs. total), diamantes de Esperanza.
- Encabezados de sección con chevron (`<` `>` con `clip-path`).
- Cajas con esquina cortada para armas / armadura / rasgos.
- Tipografía: sans-serif del sistema, peso bold, letter-spacing ajustado
  para imitar el look condensado del original.

## Mapeo de datos (todo en español)

Cabecera: `character.name`, `character.pronouns`, `view.heritageLabel`,
`view.subclassName`, `character.level`.

Rasgos: `view.traits` (label + modifier), con las frases de ejemplo
traducidas estáticamente:

- Agilidad → Correr, Saltar, Maniobrar
- Fuerza → Levantar, Golpear, Forcejear
- Destreza → Controlar, Ocultarse, Manipular
- Instinto → Percibir, Sentir, Navegar
- Presencia → Encantar, Actuar, Engañar
- Conocimiento → Recordar, Analizar, Comprender

Defensas: `character.evasion`, `character.armorScore`, `character.major`,
`character.severe`.

Salud: `sheet.hpMarked` / `character.hpSlots`, `sheet.stressMarked` /
`character.stressSlots`, `sheet.hope` (diamantes de Esperanza),
`view.hopeFeature`.

Experiencias: `character.experiences` (nombre + modificador).

Oro: `sheet.gold.handfuls` / `.bags` / `.chests` (puñados / bolsas /
cofres), tal como ya se etiquetan en `SheetRoute`.

Rasgo de clase: `view.classFeatures`, `view.subclassFeatures`,
`view.ancestryFeatures`, `view.communityFeature` — mismos grupos que
"Rasgos de clase" en `SheetRoute`.

Armas: 2 cajas prellenadas desde `view.primaryWeapon` /
`view.secondaryWeapon` (nombre, rasgo, alcance, dado de daño, rasgo
especial) + 2 cajas en blanco (líneas vacías) para completar a mano,
igual que la hoja oficial en blanco.

Armadura activa: `view.armor` (nombre, umbrales base, puntuación base,
rasgo).

Inventario: `character.inventory` (lista de texto libre).

## Manejo de overflow

Fiel a 1 página. El diseño usa las mismas cajas de tamaño fijo que el
original; si una lista (inventario, rasgos de clase) es más larga que el
espacio disponible, se reduce el tamaño de fuente dentro de esa caja
específica (no se reduce toda la hoja) y, si aun así no cabe, se recorta
con overflow oculto — igual que pasaría al escribir a mano de más en una
hoja física.

## Pruebas

No aplica suite de vitest (es maquetación/CSS). Verificación manual:
`pnpm -F @daggerheart/web dev`, abrir un personaje, click "Exportar PDF",
revisar vista previa en pantalla y la vista previa de impresión del
navegador (Ctrl+P) contra la imagen de referencia.
