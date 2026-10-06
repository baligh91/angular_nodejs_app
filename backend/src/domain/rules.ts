export const FORMATS = { 5: 250, 7: 300, 11: 500 } as const;
export type Format = keyof typeof FORMATS;

export interface Performance {
  id: string;
  gwPoints: number;
  form: number;
}

export function initialPrice(rank: number, count: number): number {
  if (count <= 1) return 100;
  return Math.round(100 - ((Math.max(1, Math.min(rank, count)) - 1) / (count - 1)) * 90);
}

// Midrank percentiles keep equal performances equal, regardless of database ordering.
export function priceDeltas(managers: Performance[]): Map<string, number> {
  const values = managers.map((m) => ({ id: m.id, value: (m.gwPoints + m.form) / 2 }));
  return new Map(values.map((m) => {
    const better = values.filter((x) => x.value > m.value).length;
    const equal = values.filter((x) => x.value === m.value).length;
    const percentile = (better + equal / 2) / values.length;
    const delta = percentile <= 0.1 ? 2 : percentile <= 0.3 ? 1
      : percentile >= 0.9 ? -2 : percentile >= 0.7 ? -1 : 0;
    return [m.id, delta];
  }));
}

export function nextPrice(price: number, delta: number): number {
  return Math.max(10, Math.min(150, price + delta));
}

export function teamPoints(
  managerIds: string[], captainId: string, points: Map<string, number>,
): number {
  return managerIds.reduce((sum, id) => sum + (points.get(id) ?? 0) * (id === captainId ? 2 : 1), 0);
}

export interface RecruitmentPolicy {
  canRecruit(managerId: string, otherTeamManagerIds: ReadonlySet<string>): boolean;
}

export class NonexclusiveRecruitment implements RecruitmentPolicy {
  canRecruit(): boolean { return true; }
}

export class ExclusiveRecruitment implements RecruitmentPolicy {
  canRecruit(managerId: string, otherTeamManagerIds: ReadonlySet<string>): boolean {
    return !otherTeamManagerIds.has(managerId);
  }
}
