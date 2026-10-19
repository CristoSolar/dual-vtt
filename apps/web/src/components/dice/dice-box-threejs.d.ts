/** The slice of `@3d-dice/dice-box-threejs` the overlay uses; the package ships no types. */
declare module '@3d-dice/dice-box-threejs' {
  export interface DiceColorset {
    name: string;
    foreground: string;
    background: string;
    outline: string;
    texture: string;
    material: string;
  }

  export interface DiceBoxConfig {
    sounds?: boolean;
    shadows?: boolean;
    theme_customColorset?: DiceColorset;
  }

  export default class DiceBox {
    /** `selector` is passed to `document.querySelector`; the box draws inside it. */
    constructor(selector: string, config?: DiceBoxConfig);
    initialize(): Promise<void>;
    /** Throws the dice. A notation like `2d12@7,3` forces the faces they land on. */
    roll(notation: string): Promise<unknown>;
    clearDice(): void;
    renderer: { dispose(): void };
  }
}
