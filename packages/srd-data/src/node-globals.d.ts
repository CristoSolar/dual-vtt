// ponytail: only what validate.ts touches, so no @types/node dependency.
// Swap this file for `@types/node` if anything here ever needs the real Node API.
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
declare const process: { exit(code: number): never };
