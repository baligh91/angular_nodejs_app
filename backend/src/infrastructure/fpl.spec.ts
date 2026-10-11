import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from './config';
import { FplClient } from './fpl';

describe('public FPL entry adapter', () => {
  const raw = () => ({
    id: 123, player_first_name: 'First', player_last_name: 'Last', name: 'Public team',
    summary_overall_points: 100, summary_event_points: 20, favourite_team: 1,
    leagues: { classic: [{ id: 456, name: 'Public league' }] },
    player_region_name: 'Private region', date_of_birth: 'private', email: 'private',
  });
  const client = () => new FplClient({ fplBase: 'https://fantasy.premierleague.com/api/' } as Config);
  afterEach(() => jest.restoreAllMocks());

  it('projects only the four identity fields needed by the single collection', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(raw()), { status: 200 }));
    expect(await client().entry(123)).toEqual({
      id: 123, firstName: 'First', lastName: 'Last', teamName: 'Public team',
      leagues: [{ id: 456, name: 'Public league' }],
    });
    expect(fetcher.mock.calls[0][0].toString()).toContain('/entry/123/');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves entry-not-found as 404 without retry', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(client().entry(123)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns the manager current-gameweek and season points', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...raw(), current_event: 8,
    }), { status: 200 }));
    await expect(client().managerScore(123)).resolves.toEqual({
      currentGameweek: 8, currentGameweekPoints: 20, totalPoints: 100,
    });
    expect(fetcher.mock.calls[0][0].toString()).toContain('/entry/123/');
  });

  it.each([
    { id: 999 }, { current_event: '8' }, { summary_event_points: '20' },
  ])('rejects invalid manager score fields: %j', async (override) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...raw(), current_event: 8, ...override,
    }), { status: 200 }));
    await expect(client().managerScore(123)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    { id: 999 }, { player_first_name: 123 }, { name: 'x'.repeat(101) },
  ])('rejects invalid or mismatched upstream fields: %j', async (override) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...raw(), ...override }), { status: 200 }));
    await expect(client().entry(123)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
