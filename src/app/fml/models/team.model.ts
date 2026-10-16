import type { Manager } from './manager.model';

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
  seasonScore: number;
  editsLocked: boolean;
  firstScoringGw: number | null;
  currentDeadline: string | null;
}

export const BUDGETS: Record<5, number> = { 5: 250 };

export function selectionCost(managers: readonly Manager[]): number {
  return managers.reduce((total, manager) => total + manager.price, 0);
}

export function squadBudget(
  managers: readonly Manager[], ownedManagers: readonly Manager[], baseBudget = BUDGETS[5],
): number {
  const purchasePrices = new Map(ownedManagers.map((manager) => [
    manager.fplId, manager.purchasePrice ?? manager.price,
  ]));
  return baseBudget + managers.reduce((total, manager) =>
    total + Math.max(0, manager.price - (purchasePrices.get(manager.fplId) ?? manager.price)), 0);
}