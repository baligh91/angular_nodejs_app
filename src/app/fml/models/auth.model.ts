import type { FplLeague } from './league.model';
import type { Team, TeamScore } from './team.model';

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