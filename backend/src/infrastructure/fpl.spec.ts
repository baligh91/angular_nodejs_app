import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Config } from './config';
import { FplClient } from './fpl';

describe('public FPL entry adapter', () => {
  const raw = () => ({
    id: 123, player_first_name: 'First', player_last_name: 'Last', name: 'Public team',
    summary_overall_points: 100, summary_overall_rank: 20,
    summary_event_points: -2, summary_event_rank: null, favourite_team: 1,
    leagues: { classic: [{ id: 456, name: 'Public league', entry_rank: 3, private_flag: true }] },
    player_region_name: 'Private region', date_of_birth: 'private', email: 'private',
  });
  const client = () => new FplClient({ fplBase: 'https://fantasy.premierleague.com/api/' } as Config);
  afterEach(() => jest.restoreAllMocks());

  it('projects only dashboard fields and resolves the favorite club', async () => {
    const fetcher = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(raw()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ teams: [{ id: 1, name: 'Arsenal', code: 99 }] }), { status: 200 }));
    expect(await client().entry(123)).toEqual({
      id: 123, firstName: 'First', lastName: 'Last', teamName: 'Public team',
      overallPoints: 100, overallRank: 20, gameweekPoints: -2, gameweekRank: null,
      favoriteTeam: { id: 1, name: 'Arsenal' }, leagues: [{ id: 456, name: 'Public league', rank: 3 }],
    });
    expect(fetcher.mock.calls[0][0].toString()).toContain('/entry/123/');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('preserves entry-not-found as 404 without retry', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(client().entry(123)).rejects.toBeInstanceOf(NotFoundException);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns explicit null for unranked entries, unavailable points and no favorite club', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...raw(), summary_overall_points: null, summary_event_points: null,
      summary_overall_rank: null, summary_event_rank: null, favourite_team: null,
      leagues: { classic: [{ id: 456, name: 'Public league', entry_rank: null }] },
    }), { status: 200 }));
    expect(await client().entry(123)).toMatchObject({
      overallPoints: null, overallRank: null, gameweekPoints: null, gameweekRank: null,
      favoriteTeam: null, leagues: [{ id: 456, name: 'Public league', rank: null }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id: 999 }, { summary_overall_points: '100' }, { summary_event_rank: -1 },
    { leagues: { classic: [{ id: 0, name: 'Invalid' }] } },
  ])('rejects invalid or mismatched upstream fields: %j', async (override) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...raw(), ...override }), { status: 200 }));
    await expect(client().entry(123)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
