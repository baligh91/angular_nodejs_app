export const FORMATS = { 5: 250 } as const;
export const FIRST_SCORING_GAMEWEEK = 7;
export type Format = 5;

export interface ScoringRecord {
  gw: number;
  points: number;
  total: number;
  managerIds: number[];
  captainId: number;
  teamName: string;
  capturedAt: Date;
}

export function scoringHistory(scores: readonly ScoringRecord[]): ScoringRecord[] {
  let total = 0;
  return Array.from(scores, (score) => ({
    gw: score.gw, points: score.points, total: score.total,
    managerIds: [...score.managerIds], captainId: score.captainId,
    teamName: score.teamName, capturedAt: score.capturedAt,
  }))
    .filter((score) => score.gw >= FIRST_SCORING_GAMEWEEK)
    .sort((a, b) => a.gw - b.gw)
    .map((score) => {
      total += score.points;
      return { ...score, total };
    });
}

export function initialPrice(rank: number, count: number): number {
  if (count <= 1) return 100;
  return Math.round(100 - ((Math.max(1, Math.min(rank, count)) - 1) / (count - 1)) * 90);
}

export function budgetWithAppreciation(
  managers: readonly { price: number; purchasePrice?: number }[], transferCapital: number = FORMATS[5],
): number {
  return Math.max(FORMATS[5], transferCapital + managers.reduce((total, manager) =>
    total + manager.price - (manager.purchasePrice ?? manager.price), 0));
}

export function teamPoints(
  managerIds: string[], captainId: string, points: Map<string, number>,
): number {
  return managerIds.reduce((sum, id) => sum + (points.get(id) ?? 0) * (id === captainId ? 2 : 1), 0);
}
