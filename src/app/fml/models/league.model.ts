import type { Manager } from './manager.model';

export interface FplLeague { id: number; name: string }

export interface TeamStanding {
  rank: number;
  ownerFplId: number;
  ownerName: string;
  teamName: string;
  gw: number | null;
  gwScore: number;
  seasonScore: number;
}

export interface LeagueTeam {
  ownerFplId: number;
  ownerName: string;
  teamName: string;
  captainId: number;
  managers: Manager[];
}