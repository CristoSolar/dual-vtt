import type { ConnectionStatus } from './useCampaign.js';

/**
 * What an in-campaign route (`/sheet`, `/map`, `/gm`) shows before its data is in.
 * After a reload the room arrives over the socket a moment later; sending the user
 * home in that gap lost their place on every F5. Only when nothing is on its way —
 * no active campaign, a failed connection, or a refused join — is home the answer.
 */
export type RouteGate = 'render' | 'wait' | 'home';

export function campaignRouteGate(input: {
  activeCampaignId: string | null;
  roomLoaded: boolean;
  status: ConnectionStatus;
  error: string | null;
  /** Route-specific requirement once the room is in (a sheet, the GM seat). */
  allowed: boolean;
}): RouteGate {
  if (input.roomLoaded) return input.allowed ? 'render' : 'home';
  if (input.activeCampaignId === null) return 'home';
  if (input.status === 'error' || input.error !== null) return 'home';
  return 'wait';
}
