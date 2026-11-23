import { describe, expect, it } from 'vitest';

import { campaignRouteGate } from '../src/state/routeGate.js';

const base = {
  activeCampaignId: 'c1',
  roomLoaded: false,
  status: 'connecting' as const,
  error: null,
  allowed: false,
};

describe('campaignRouteGate', () => {
  it('waits while a reload is still fetching the room', () => {
    expect(campaignRouteGate(base)).toBe('wait');
  });

  it('renders once the room is in and the route allows it', () => {
    expect(campaignRouteGate({ ...base, roomLoaded: true, status: 'connected', allowed: true })).toBe('render');
  });

  it('goes home when the room is in but the route does not apply (no sheet, not GM)', () => {
    expect(campaignRouteGate({ ...base, roomLoaded: true, status: 'connected' })).toBe('home');
  });

  it('goes home with no campaign, a failed connection, or a refused join', () => {
    expect(campaignRouteGate({ ...base, activeCampaignId: null })).toBe('home');
    expect(campaignRouteGate({ ...base, status: 'error' })).toBe('home');
    expect(campaignRouteGate({ ...base, error: 'not a member' })).toBe('home');
  });
});
