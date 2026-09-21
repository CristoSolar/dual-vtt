# Actualización de la plataforma — Daggerheart VTT

Texto listo para publicar en las actualizaciones de GroupFinder. Resume lo que
entró en esta tanda de trabajo, escrito para quien juega, no para quien programa.

---

## Daggerheart VTT ahora corre con el SRD 2.0

La mesa virtual se ha puesto al día con la nueva versión del SRD (la expansión
*Hope and Fear*) y, de paso, hemos arreglado lo que faltaba de la anterior. Todo
el contenido está en español y en inglés, y se puede cambiar de idioma en
cualquier momento.

### Contenido nuevo

Todo el material se extrae del propio PDF del SRD y se verifica reproduciendo los
datos anteriores, así que lo que aparece en la aplicación es lo que está impreso.

| | Antes | Ahora |
|---|---|---|
| Clases y subclases | 9 y 18 | 13 y 26 |
| Cartas de dominio | 189 | 210 |
| Ancestros y comunidades | 18 y 9 | 24 y 15 |
| Adversarios y entornos | 129 y 19 | 264 y 47 |
| Armas y armaduras | 204 y 34 | 315 y 69 |
| Botín y consumibles | 60 y 60 | 120 y 120 |
| Transformaciones | — | 6 |

### Reglas que antes no existían o estaban mal

- **Descansos y tiempo libre.** El GM abre un descanso corto o largo, cobra su
  Miedo, y cada personaje gasta sus dos movimientos desde su propia hoja. Tres
  descansos cortos seguidos obligan a que el siguiente sea largo.
- **Movimientos de muerte.** Los tres, resueltos de verdad: cicatrices que tachan
  ranuras de Esperanza para siempre, inconsciencia que se cura al sanar o al
  descansar largo, y Arriesgarlo Todo tirado en el servidor y registrado.
- **Condiciones.** Oculto, Inmovilizado, Vulnerable y las que inventen las
  features, visibles en la hoja y sobre la ficha del mapa.
- **Tiradas de adversario.** El GM tira d20 contra la Evasión del objetivo, con
  ventaja, desventaja, Experiencia por 1 Miedo y crítico en 20 natural.
- **Features de adversario y de entorno** usables desde el panel: gastan el Miedo
  que pide su texto, y las Evoluciones son de un solo uso.
- **Tiradas de reacción**, que no generan Esperanza ni Miedo. Antes esquivar le
  regalaba un Miedo al GM.
- **Tirada en equipo y acción grupal.** Tres Esperanza combinan dos personajes, y
  ni la Esperanza ni el Miedo se pagan hasta elegir qué tirada vale para las dos.
  En una acción grupal el líder suma +1 por cada colaborador que acierta y −1 por
  cada uno que falla.
- **Forma bestial del Druida**, que antes sólo se podía leer en el compendio.
- **Equipo cambiable**, subidas de nivel que antes no hacían nada, features de
  Esperanza de clase, inventario editable y el límite de cartas del dominio de
  multiclase.
- **Puntos de batalla** para montar encuentros equilibrados, **reservas de fichas**
  de adversario, **seguimiento del foco** opcional, **tiradas del destino**,
  caídas, colisiones y el presupuesto de Miedo por escena.

### La mesa se entiende mejor

- Desde la hoja se ve cuánto Miedo tiene el GM, si el foco está en ti, y cómo
  están de Puntos de Golpe, Estrés y Esperanza el resto del grupo.
- La pantalla del GM se abre **encima del mapa**, así que ya no hay que salir de
  la mesa para gastar un Miedo.
- El mapa se maneja con el teclado (Esc, Supr, F para ajustar, +/− para el zoom),
  la regla está disponible también para los jugadores, tu ficha aparece donde
  estás mirando, el ajuste a cuadrícula tiene en cuenta el tamaño de la ficha y se
  puede desactivar, y en tableta se hace zoom con dos dedos.
- El registro de tiradas se filtra por tipo y se contrae.
- La creación de personaje termina con un resumen de lo elegido.
- El compendio busca en todas las listas a la vez, y las cartas de la hoja
  enlazan a su entrada.
- Los diálogos atrapan el foco y lo devuelven, salir de la campaña y empezar el
  personaje de cero piden confirmación, y los avisos se apilan en lugar de
  pisarse.
- Los formularios son formularios: Enter envía, el gestor de contraseñas
  funciona, y las contraseñas tienen un mínimo de ocho caracteres.
- Las pantallas estrechas ya no rompen la barra superior ni los nueve pasos de la
  creación.

### Por debajo

Se cerró un fallo serio: **subir imágenes de mapa no pedía autenticación**. Ahora
lo hace, se validan las rutas, hay límite de intentos de acceso, las sesiones
caducan y las instantáneas se escriben de forma atómica para que un apagón no
deje un archivo a medias.

### Licencia

El proyecto usa el SRD 2.0 de Daggerheart bajo la Darrington Press Community
Gaming License, con la atribución que pide y los logotipos de contenido
comunitario que Darrington publicó. No reproduce los Campaign Frames.
