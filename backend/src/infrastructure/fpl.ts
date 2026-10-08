import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from './config';

export interface FplEvent {
  id: number; deadline_time: string; finished: boolean; is_current: boolean; data_checked: boolean;
}
export interface FplStanding {
  entry: number; player_name: string; rank: number; total: number; event_total: number;
}
export interface FplHistory {
  event: number; points: number; overall_rank: number;
}
export interface FplLeague {
  id: number; name: string;
}
export interface FplProfile {
  id: number; firstName: string; lastName: string; teamName: string;
  leagues: FplLeague[];
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
    if (data.id !== id || typeof data.player_first_name !== 'string' || typeof data.player_last_name !== 'string'
      || typeof data.name !== 'string' || data.name.length > 100 || !Array.isArray(data.leagues?.classic)) {
      throw new ServiceUnavailableException('Invalid FPL entry');
    }
    const leagues = data.leagues.classic.map((league: Record<string, unknown>) => {
      if (!Number.isSafeInteger(league.id) || Number(league.id) < 1 || typeof league.name !== 'string') {
        throw new ServiceUnavailableException('Invalid FPL classic league');
      }
      return { id: Number(league.id), name: league.name };
    });
    return { id, firstName: data.player_first_name, lastName: data.player_last_name, teamName: data.name, leagues };
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
          || manager.rank < 1 || !Number.isFinite(manager.total) || !Number.isFinite(manager.event_total)
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
