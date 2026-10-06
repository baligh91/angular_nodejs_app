import { Types } from 'mongoose';
import { initialPrice, teamPoints } from '../domain/rules';
import { Database } from './database';

export const FIXTURE_LEAGUE_ID = '600000000000000000000001';
export const FIXTURE_USER_ID = '600000000000000000000002';
export const FIXTURE_ADMIN_ID = '600000000000000000000003';
export const FIXTURE_TEAM_ID = '600000000000000000000004';
export const fixtureManagerId = (rank: number) => `61000000000000000000${rank.toString().padStart(4, '0')}`;

export async function seedFixtures(db: Database) {
  if (process.env.NODE_ENV === 'production') throw new Error('Offline fixtures are forbidden in production');
  const leagueId = new Types.ObjectId(FIXTURE_LEAGUE_ID);
  const teamId = new Types.ObjectId(FIXTURE_TEAM_ID);
  await db.transaction(async (session) => {
    for (const user of [
      { _id: FIXTURE_USER_ID, fplId: 90000020, pseudo: 'Joueur démo', role: 'user' },
      { _id: FIXTURE_ADMIN_ID, fplId: 90000001, pseudo: 'Admin démo', role: 'admin' },
    ]) {
      await db.users.updateOne({ _id: new Types.ObjectId(user._id) }, { $set: {
        fplId: user.fplId, pseudo: user.pseudo, role: user.role, disabled: false,
        fplProfile: { id: user.fplId, firstName: user.role === 'admin' ? 'Admin' : 'Joueur',
          lastName: 'démo', teamName: 'FML démonstration', overallPoints: 260, overallRank: 1,
          gameweekPoints: 260, gameweekRank: 1, favoriteTeam: null,
          leagues: [{ id: 999001, name: 'FML démonstration', rank: null }] },
        tokenVersion: 0,
      }, $unset: { refreshHash: 1, refreshExpires: 1 } }, { upsert: true, session });
    }
    await db.leagues.updateOne({ _id: leagueId }, { $set: {
      fplId: 999001, name: 'FML démonstration (hors ligne)', active: true,
      importedAt: new Date('2020-01-01'), lastSyncedAt: new Date('2020-01-02'), pricingFromGw: 2,
    } }, { upsert: true, session });
    const points = new Map<string, number>();
    for (let rank = 1; rank <= 20; rank++) {
      const id = new Types.ObjectId(fixtureManagerId(rank));
      const score = 80 - rank * 2;
      points.set(id.toString(), score);
      const price = initialPrice(rank, 20);
      await db.managers.updateOne({ _id: id }, { $set: {
        leagueId, fplId: 90000000 + rank, name: `Manager ${rank.toString().padStart(2, '0')}`,
        rank, gwPoints: score, form: score, price, active: true,
        history: [{ gw: 1, points: score, rank: rank * 1000 }],
      } }, { upsert: true, session });
      await db.prices.updateOne({ managerId: id, gw: 0 }, {
        $set: { leagueId, price, delta: 0 },
      }, { upsert: true, session });
    }
    await db.gameweeks.updateOne({ id: 1 }, { $set: {
      deadline: new Date('2020-01-01T12:00:00Z'), finished: true, current: false,
      dataChecked: true, snapshotsCaptured: true, processingComplete: true,
    } }, { upsert: true, session });
    await db.gameweeks.updateOne({ id: 2 }, { $set: {
      deadline: new Date('2099-01-01T12:00:00Z'), finished: false, current: true,
      dataChecked: false, snapshotsCaptured: true, processingComplete: false,
    } }, { upsert: true, session });
    const managerIds = [16, 17, 18, 19, 20].map((rank) => new Types.ObjectId(fixtureManagerId(rank)));
    const captainId = managerIds[4];
    const spent = [16, 17, 18, 19, 20].reduce((sum, rank) => sum + initialPrice(rank, 20), 0);
    const total = teamPoints(managerIds.map(String), captainId.toString(), points);
    await db.teams.updateOne({ _id: teamId }, { $set: {
      userId: new Types.ObjectId(FIXTURE_USER_ID), leagueId, name: 'Les Stratèges',
      format: 5, managerIds, captainId, budget: 250, spent, points: total, rank: 1,
    } }, { upsert: true, session });
    await db.members.deleteMany({ teamId }).session(session);
    await db.members.insertMany(managerIds.map((managerId) => ({
      teamId, managerId, captain: managerId.equals(captainId),
    })), { session });
    for (const gw of [1, 2]) {
      await db.scores.updateOne({ teamId, gw }, { $set: {
        leagueId, userId: new Types.ObjectId(FIXTURE_USER_ID), teamName: 'Les Stratèges',
        pseudo: 'Joueur démo', managerIds, captainId,
        capturedAt: new Date('2019-12-31T12:00:00Z'), points: gw === 1 ? total : 0, scored: gw === 1,
        ...(gw === 1 ? { overallPoints: total, rank: 1, teamValue: spent } : {}),
      }, ...(gw === 2 ? { $unset: { overallPoints: 1, rank: 1, teamValue: 1 } } : {}) }, { upsert: true, session });
    }
    for (const gw of [0, 1]) await db.rankings.updateOne({ leagueId, teamId, gw }, { $set: {
      rank: 1, teamName: 'Les Stratèges', pseudo: 'Joueur démo', points: total,
    } }, { upsert: true, session });
    await db.connection.collection('operations').updateOne({
      key: `processed:${leagueId}:1`,
    }, { $set: { completedAt: new Date('2020-01-02') } }, { upsert: true, session });
  });
}
