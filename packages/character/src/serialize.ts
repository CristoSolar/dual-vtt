import { CreationStateSchema, type CreationState } from './types.js';

/** Current on-disk format. Bump when the state shape changes incompatibly. */
export const SERIALIZATION_VERSION = 1;

/** Serializes an in-progress creation so it can be resumed later. */
export function serialize(state: CreationState): string {
  return JSON.stringify({ version: SERIALIZATION_VERSION, state });
}

/**
 * Restores a serialized creation. Throws if the payload is not valid JSON, is from a
 * different version, or does not match `CreationStateSchema` — a resumed creation is
 * a trust boundary, so it is parsed rather than cast.
 */
export function deserialize(payload: string): CreationState {
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('deserialize: payload is not an object');
  }

  const envelope = parsed as { version?: unknown; state?: unknown };
  if (envelope.version !== SERIALIZATION_VERSION) {
    throw new Error(
      `deserialize: unsupported version ${String(envelope.version)}, expected ${SERIALIZATION_VERSION}`,
    );
  }

  return CreationStateSchema.parse(envelope.state);
}
