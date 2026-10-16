export const FORMATS = { 5: 250 } as const;
export type Format = 5;

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
