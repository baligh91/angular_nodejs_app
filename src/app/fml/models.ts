export interface User {
  id: string;
  fplId: number;
  firstName: string;
  lastName: string;
  fplTeamName: string;
  fplLeagues: FplLeague[];
  team?: Team;
  scoreHistory: TeamScore[];
  totalScore: number;
  disabled?: boolean;
}
export interface Session { accessToken: string; user: User }
export interface FplLeague { id: number; name: string }
export interface Manager {
  id: number;
  fplId: number;
  name: string;
  rank: number;
  totalPoints: number;
  lastGwPoints: number;
  gwPoints: number;
  form: number;
  price: number;
  priceHistory?: { gw: number; price: number; delta: number }[];
}
export type Format = 5;
export interface TeamInput {
  name: string;
  leagueFplId: number;
  managerIds: number[];
  captainId: number;
}
export interface TeamScore {
  gw: number;
  points: number;
  total: number;
  managerIds: number[];
  captainId: number;
  teamName: string;
  capturedAt: string;
}
export interface Team {
  id: number;
  name: string;
  leagueName: string;
  format: 5;
  leagueFplId: number | null;
  managerIds: number[];
  captainId: number | null;
  budget: number;
  spent: number;
  members: Manager[];
  scores: TeamScore[];
  totalScore: number;
  editsLocked: boolean;
  firstScoringGw: number | null;
  currentDeadline: string | null;
}
export interface ManagerLeague { leagueFplId: number; leagueName: string; managers: Manager[] }
export interface TeamStanding {
  rank: number;
  ownerFplId: number;
  ownerName: string;
  teamName: string;
  points: number;
}
export const BUDGETS: Record<5, number> = { 5: 250 };
export function selectionCost(managers: readonly Manager[]): number {
  return managers.reduce((total, manager) => total + manager.price, 0);
}
