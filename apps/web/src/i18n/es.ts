/** Every UI string, Spanish. `en.ts` is typed against this object, so a key added
 * here without an English twin fails typecheck. Keys are `area.name`. */
export const es = {
  // locale toggle
  'locale.switchTo': 'English',

  // sheet effects (protocol SheetEffect booleans + codes)
  'effect.stressBecameHP': 'No queda Estrés — marcaste 1 Punto de Vida en su lugar.',
  'effect.vulnerable': 'Todo el Estrés marcado — estás Vulnerable.',
  'effect.deathMoveRequired': 'Último Punto de Vida marcado — haz un movimiento de muerte.',
  'effect.damageApplied': 'Daño {severity} — marcaste {hpMarked} PV.',
  'effect.recalled': 'Recuperada fuera de un descanso — marcaste {stressCost} de Estrés.',
  'effect.notEnoughHope': 'No tienes suficiente Esperanza (necesitas {amount}).',
  'effect.noArmorSlots': 'No quedan Casillas de Armadura.',
  'effect.notEnoughGold': 'No tienes suficiente oro (necesitas {amount} {unit}).',
  'effect.loadoutFull': 'El equipo activo está lleno — elige una carta para mover a la bóveda.',
  'effect.notEnoughStress': 'No hay Estrés sin marcar para pagar el Coste de Recuperación.',
  'effect.cardNotInVault': 'Esa carta no está en la bóveda.',
  'effect.cardNotInLoadout': 'Esa carta no está en el equipo activo.',
  'effect.swapNotAllowed': 'Ese intercambio no está permitido.',
  'effect.levelUpRejected': 'Subida de nivel rechazada: {message}',
  'effect.unknownMulticlass': 'Ese multiclase nombra una clase o dominio desconocido.',
  'effect.levelledUp': 'Subiste al nivel {level}.',

  // server rejections (RoomError + gateway codes)
  'reject.notGameMaster': 'Solo el DJ puede hacer eso.',
  'reject.notYourCharacter': 'Ese personaje no es tuyo.',
  'reject.unknownCharacter': 'Personaje desconocido.',
  'reject.unknownCountdown': 'Cuenta regresiva desconocida.',
  'reject.unknownAdversary': 'Adversario desconocido.',
  'reject.notEnoughFear': 'No hay suficiente Miedo.',
  'reject.unknownScene': 'Escena desconocida.',
  'reject.unknownToken': 'Ficha desconocida.',
  'reject.notYourToken': 'Esa ficha no es tuya.',
  'reject.tokenExists': 'Ya existe una ficha con ese identificador.',
  'reject.tooManyWalls': 'Demasiados muros en esta escena.',
  'reject.badRequest': 'El servidor no entendió esa acción.',
  'reject.forbidden': 'Ya no eres miembro de esta campaña.',
  'reject.noSeat': 'Únete a una campaña primero.',
  'reject.rejected': 'El servidor rechazó esa acción.',
  'reject.unknown': 'El servidor rechazó esa acción ({code}).',

  // roll log
  'roll.outcome.criticalSuccess': 'Éxito Crítico',
  'roll.outcome.successHope': 'Éxito con Esperanza',
  'roll.outcome.successFear': 'Éxito con Miedo',
  'roll.outcome.failureHope': 'Fallo con Esperanza',
  'roll.outcome.failureFear': 'Fallo con Miedo',
  'roll.dualityLine': '{by}: {label} — {outcome} (total {total})',
  'roll.damageLine': '{by}: {label} — {total} de daño',
} as const;
