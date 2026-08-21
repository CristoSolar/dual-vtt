import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoomState } from '@daggerheart/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { readCampaignsSnapshot, writeCampaignsSnapshot } from '../src/campaigns-snapshot.js';
import type { SerializedCampaign } from '../src/campaigns.js';

const good = (id: string): SerializedCampaign => ({
  id,
  name: `Campaign ${id}`,
  ownerId: 'gm-1',
  memberIds: [],
  state: createRoomState(id, { id: 'gm-1', name: 'GM', connected: true }),
  seed: 1,
  rollCount: 0,
  updatedAt: 0,
});

describe('campaigns snapshot', () => {
  let dir: string | null = null;

  afterEach(async () => {
    dir = null;
  });

  it('round-trips valid campaigns', async () => {
    dir = await mkdtemp(join(tmpdir(), 'daggerheart-test-'));
    const path = join(dir, 'campaigns.json');
    await writeCampaignsSnapshot(path, [good('a'), good('b')]);
    expect((await readCampaignsSnapshot(path)).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('drops only the campaign that fails to parse, not every campaign in the file', async () => {
    // A bug once made adding a required nested field (grid.color/lineWidth)
    // reject the WHOLE array on one bad record, then the next periodic
    // snapshot wrote that emptiness back to disk — real campaign data lost.
    dir = await mkdtemp(join(tmpdir(), 'daggerheart-test-'));
    const path = join(dir, 'campaigns.json');
    const corrupt = { ...good('bad'), state: { nonsense: true } };
    await writeFile(
      path,
      JSON.stringify({ version: 1, campaigns: [good('a'), corrupt, good('b')] }),
      'utf8',
    );

    const restored = await readCampaignsSnapshot(path);
    expect(restored.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for a file from an unknown version, rather than throwing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'daggerheart-test-'));
    const path = join(dir, 'campaigns.json');
    await writeFile(path, JSON.stringify({ version: 99, campaigns: [good('a')] }), 'utf8');
    expect(await readCampaignsSnapshot(path)).toEqual([]);
  });

  it('returns nothing when the file does not exist', async () => {
    expect(await readCampaignsSnapshot('/nonexistent/campaigns.json')).toEqual([]);
  });
});
