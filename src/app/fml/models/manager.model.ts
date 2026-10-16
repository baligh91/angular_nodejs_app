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
  purchasePrice?: number;
  currentGameweek?: number | null;
  currentGameweekPoints?: number | null;
  priceHistory?: { gw: number; price: number; delta: number }[];
}

export interface ManagerLeague { leagueFplId: number; leagueName: string; managers: Manager[] }