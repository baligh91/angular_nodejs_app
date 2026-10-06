import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from './config';

export interface FplEvent {
  id: number; deadline_time: string; finished: boolean; is_current: boolean; data_checked: boolean;
}
export interface FplStanding {
  entry: number; player_name: string; rank: number; event_total: number;
}
export interface FplHistory {
  event: number; points: number; overall_rank: number;
}
export interface FplProfile {
  id: number; firstName: string; lastName: string; teamName: string;
  overallPoints: number | null; overallRank: number | null;
  gameweekPoints: number | null; gameweekRank: number | null;
  favoriteTeam: { id: number; name: string } | null;
  leagues: { id: number; name: string; rank: number | null }[];
}

@Injectable()
export class FplClient {
  constructor(private readonly config: Config) {}

  private async get<T>(path: string, entry = false): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(new URL(path, this.config.fplBase), {
          signal: AbortSignal.timeout(15000), cache: 'no-store',
          headers: { Accept: 'application/json', 'User-Agent': 'FML/1.0', 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) {
          if (entry && response.status === 404) throw new NotFoundException('FPL entry not found');
          if (response.status === 429 || response.status >= 500) throw new Error('Retryable FPL error');
          throw new ServiceUnavailableException(`FPL returned HTTP ${response.status}`);
        }
        return await response.json() as T;
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        if (error instanceof ServiceUnavailableException || attempt === 2) {
          throw new ServiceUnavailableException('FPL data is unavailable; please retry later');
        }
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
      }
    }
    throw new ServiceUnavailableException('FPL unavailable');
  }

  async entry(id: number): Promise<FplProfile> {
    const data = await this.get<Record<string, any>>(`entry/${id}/`, true);
    const rank = (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) > 0);
    if (data.id !== id || typeof data.player_first_name !== 'string' || typeof data.player_last_name !== 'string'
      || typeof data.name !== 'string' || data.name.length > 100
      || !(data.summary_overall_points === null || Number.isFinite(data.summary_overall_points))
      || !(data.summary_event_points === null || Number.isFinite(data.summary_event_points))
      || !rank(data.summary_overall_rank) || !rank(data.summary_event_rank)
      || !Array.isArray(data.leagues?.classic)) throw new ServiceUnavailableException('Invalid FPL entry');
    const leagues = data.leagues.classic.map((league: Record<string, unknown>) => {
      if (!Number.isSafeInteger(league.id) || Number(league.id) < 1 || typeof league.name !== 'string'
        || (league.entry_rank != null && !rank(league.entry_rank))) throw new ServiceUnavailableException('Invalid FPL league');
      return { id: Number(league.id), name: league.name,
        rank: league.entry_rank == null ? null : Number(league.entry_rank) };
    });
    let favoriteTeam: FplProfile['favoriteTeam'] = null;
    if (data.favourite_team != null) {
      if (!Number.isSafeInteger(data.favourite_team) || data.favourite_team < 1) {
        throw new ServiceUnavailableException('Invalid FPL favorite team');
      }
      const bootstrap = await this.get<{ teams: { id: number; name: string }[] }>('bootstrap-static/');
      if (!Array.isArray(bootstrap.teams)) throw new ServiceUnavailableException('Invalid FPL teams');
      const team = bootstrap.teams.find((team) => team.id === data.favourite_team);
      if (!team || typeof team.name !== 'string') throw new ServiceUnavailableException('Invalid FPL favorite team');
      favoriteTeam = { id: team.id, name: team.name };
    }
    return {
      id, firstName: data.player_first_name, lastName: data.player_last_name, teamName: data.name,
      overallPoints: data.summary_overall_points, overallRank: data.summary_overall_rank,
      gameweekPoints: data.summary_event_points, gameweekRank: data.summary_event_rank,
      favoriteTeam, leagues,
    };
  }

  async bootstrap(): Promise<FplEvent[]> {
    const data = await this.get<{ events: FplEvent[] }>('bootstrap-static/');
    if (!Array.isArray(data.events)) throw new ServiceUnavailableException('Invalid FPL bootstrap');
    for (const event of data.events) {
      if (!Number.isInteger(event.id) || event.id < 1 || !Number.isFinite(Date.parse(event.deadline_time))
        || typeof event.finished !== 'boolean' || typeof event.is_current !== 'boolean'
        || typeof event.data_checked !== 'boolean') throw new ServiceUnavailableException('Invalid FPL event');
    }
    return data.events;
  }

  async standings(fplId: number) {
    const managers: FplStanding[] = [];
    let name = '';
    for (let page = 1; page <= 10000; page++) {
      const data = await this.get<{
        league: { name: string }; standings: { has_next: boolean; results: FplStanding[] };
      }>(`leagues-classic/${fplId}/standings/?page_standings=${page}`);
      if (!data.league?.name || !Array.isArray(data.standings?.results)
        || typeof data.standings.has_next !== 'boolean') throw new ServiceUnavailableException('Invalid FPL standings');
      name = data.league.name;
      for (const manager of data.standings.results) {
        if (!Number.isInteger(manager.entry) || manager.entry < 1 || !Number.isInteger(manager.rank)
          || manager.rank < 1 || !Number.isFinite(manager.event_total)
          || typeof manager.player_name !== 'string') throw new ServiceUnavailableException('Invalid FPL manager');
        managers.push(manager);
      }
      if (!data.standings.has_next) return {
        name, managers: [...new Map(managers.map((manager) => [manager.entry, manager])).values()],
      };
    }
    throw new ServiceUnavailableException('FPL pagination limit reached');
  }

  async history(fplId: number) {
    const data = await this.get<{ current: FplHistory[] }>(`entry/${fplId}/history/`);
    if (!Array.isArray(data.current) || data.current.some((h) =>
      !Number.isInteger(h.event) || h.event < 1 || !Number.isFinite(h.points)
      || !Number.isInteger(h.overall_rank))) throw new ServiceUnavailableException('Invalid FPL history');
    return data.current;
  }
}
