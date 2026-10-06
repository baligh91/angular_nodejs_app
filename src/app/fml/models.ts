export interface User {
  id: string;
  fplId: number;
  pseudo: string;
  role: 'user' | 'admin';
  avatar?: string | null;
  favoriteTeam?: string | null;
  disabled?: boolean;
  fplProfile: FplProfile;
}
export interface FplLeague { id: number; name: string; rank: number | null }
export interface FplProfile {
  id: number;
  firstName: string;
  lastName: string;
  teamName: string;
  overallPoints: number | null;
  overallRank: number | null;
  gameweekPoints: number | null;
  gameweekRank: number | null;
  favoriteTeam: { id: number; name: string } | null;
  leagues: FplLeague[];
}
export interface FplChallenge {
  challengeId: string;
  code: string;
  expiresAt: string;
  profile: FplProfile;
}
export interface Session { accessToken: string; user: User }
export interface League { id: string; fplId: number; name: string; active?: boolean }
export interface Manager {
  id: string;
  fplId: number;
  name: string;
  rank: number;
  gwPoints: number;
  form: number;
  price: number;
  priceHistory?: { gw: number; price: number; delta: number }[];
}
export type Format = 5 | 7 | 11;
export interface TeamInput {
  name: string;
  leagueId: string;
  format: Format;
  managerIds: string[];
  captainId: string;
}
export interface Team extends TeamInput {
  id: string;
  budget: number;
  spent: number;
  points: number;
  rank: number;
  members: Manager[];
}
export interface Gameweek { id: number; deadline: string; finished: boolean; current: boolean }
export interface Ranking { rank: number; teamId: string; teamName: string; pseudo: string; points: number }
export interface TeamHistory {
  gw: number;
  points: number;
  overallPoints: number;
  rank: number;
  teamValue: number;
}
export const BUDGETS: Record<Format, number> = { 5: 250, 7: 300, 11: 500 };
export function selectionCost(managers: readonly Manager[]): number {
  return managers.reduce((total, manager) => total + manager.price, 0);
}
export function editsLocked(gameweeks: readonly Gameweek[], now = Date.now()): boolean {
  return gameweeks.some(gw => !gw.finished && Date.parse(gw.deadline) <= now);
}
