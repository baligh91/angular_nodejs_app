import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { Database } from './infrastructure/database';
import { FplClient, FplEvent, FplProfile } from './infrastructure/fpl';
import { TeamService } from './application/team';

describe('single-document FML API', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let db: Database;
  let token: string;
  const fplProfile = (id: number): FplProfile => ({
    id, firstName: 'FPL', lastName: `Manager ${id}`, teamName: `FPL team ${id}`,
    leagues: [{ id: 999001, name: 'Public league' }],
  });
  const events: FplEvent[] = [
    { id: 1, deadline_time: '2099-01-01T12:00:00Z', finished: false, is_current: true, data_checked: false },
    { id: 2, deadline_time: '2099-01-08T12:00:00Z', finished: false, is_current: false, data_checked: false },
    { id: 3, deadline_time: '2099-01-15T12:00:00Z', finished: false, is_current: false, data_checked: false },
  ];
  const leagueManagers = Array.from({ length: 20 }, (_, index) => ({
    entry: 90000001 + index, player_name: `Manager ${index + 1}`,
    rank: index + 1, total: 1000 - index * 10, event_total: 10,
  }));

  beforeAll(async () => {
    process.env.JWT_SECRET = 'integration-only-secret-at-least-32-characters';
    process.env.SYNC_ENABLED = 'false';
    process.env.CRON_SECRET = 'integration-cron-secret';
    process.env.NODE_ENV = 'test';
    process.env.MONGOMS_DOWNLOAD_DIR = `${process.cwd()}\\.mongodb-binaries`;
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    process.env.MONGODB_URI = mongo.getUri('fml');
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
    db = app.get(Database);
    const fpl = app.get(FplClient);
    jest.spyOn(fpl, 'entry').mockImplementation(async (id) => fplProfile(id));
    jest.spyOn(fpl, 'managerScore').mockImplementation(async (id) => ({
      currentGameweek: events.find((event) => event.is_current)?.id ?? null,
      currentGameweekPoints: id % 10, totalPoints: 1000 + id % 100,
    }));
    jest.spyOn(fpl, 'bootstrap').mockResolvedValue(events);
    jest.spyOn(fpl, 'standings').mockImplementation(async () => ({ name: 'Public league', managers: leagueManagers }));
    jest.spyOn(fpl, 'history').mockImplementation(async (id) => [
      { event: 1, points: id === 90000016 ? 10 : 5, overall_rank: id },
      { event: 2, points: id - 90000000, overall_rank: id },
      { event: 3, points: 15, overall_rank: id },
    ]);
  });
  afterAll(async () => { await app?.close(); await mongo?.stop(); });

  it('stores password-backed accounts, one format-5 team, and scores in only users', async () => {
    const password = 'abc123';
    const registration = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ fplId: 72021, password }).expect(201);
    expect(registration.body.user).not.toHaveProperty('passwordHash');
    const stored = await db.users.findOne({ fplId: 72021 }).select('+passwordHash').lean();
    expect(stored?.passwordHash).not.toBe(password);
    await request(app.getHttpServer()).post('/api/auth/login')
      .send({ fplId: 72021, password: 'incorrect password' }).expect(401);
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .send({ fplId: 72021, password }).expect(200);
    token = login.body.accessToken;
    expect(login.body.user).toMatchObject({ fplId: 72021, firstName: 'FPL', lastName: 'Manager 72021' });
    expect(login.body.user.fplLeagues).toEqual([{ id: 999001, name: 'Public league' }]);

    const userLeagues = await request(app.getHttpServer()).get('/api/team/leagues')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(userLeagues.body).toEqual([{ id: 999001, name: 'Public league' }]);

    const league = await request(app.getHttpServer()).get('/api/team/managers?leagueFplId=999001')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(league.body.managers).toHaveLength(20);

    const managerIds = [90000016, 90000017, 90000018, 90000019, 90000020];
    const saved = await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Five managers', leagueFplId: 999001, managerIds, captainId: managerIds[0] }).expect(200);
    expect(saved.body).toMatchObject({ format: 5, spent: 97, members: expect.any(Array), totalScore: 0 });
    expect(saved.body.members).toHaveLength(5);
    expect(saved.body.firstScoringGw).toBe(7);
    const leagueTeam = await request(app.getHttpServer())
      .get('/api/team/league-team?leagueFplId=999001&ownerFplId=72021')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(leagueTeam.body).toMatchObject({
      ownerFplId: 72021, teamName: 'Five managers', captainId: managerIds[0],
      managers: expect.arrayContaining([
        expect.objectContaining({
          fplId: managerIds[0], name: 'Manager 16', rank: 16, currentGameweekPoints: 0,
        }),
      ]),
    });
    expect(leagueTeam.body.managers).toHaveLength(5);
    await request(app.getHttpServer())
      .get('/api/team/league-team?leagueFplId=999002&ownerFplId=72021')
      .set('Authorization', `Bearer ${token}`).expect(404);

    expect(saved.body.budget).toBe(250);
    expect(saved.body.members[0]).toMatchObject({ price: 29, purchasePrice: 29 });
    leagueManagers[15].rank = 1;
    const repriced = await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Five managers', leagueFplId: 999001, managerIds, captainId: managerIds[0] }).expect(200);
    expect(repriced.body).toMatchObject({ budget: 321, spent: 168 });
    expect(repriced.body.members[0]).toMatchObject({ rank: 1, price: 100, purchasePrice: 29 });
    leagueManagers[15].rank = 16;

    const sharedManagers = [90000011, 90000012, 90000013, 90000014, 90000015];
    const secondLogin = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ fplId: 72022, password }).expect(201);
    const thirdLogin = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ fplId: 72023, password }).expect(201);
    await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${secondLogin.body.accessToken}`)
      .send({ name: 'FML Runner Up', leagueFplId: 999001, managerIds: sharedManagers, captainId: sharedManagers[0] })
      .expect(200);
    await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${thirdLogin.body.accessToken}`)
      .send({ name: 'FML Third', leagueFplId: 999001, managerIds: sharedManagers, captainId: sharedManagers[4] })
      .expect(200);

    await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Moved league', leagueFplId: 999002, managerIds, captainId: managerIds[0] }).expect(400);
    const beforeDeadline = await db.users.findOne({ fplId: 72021 }).lean();
    expect(beforeDeadline?.team?.pendingSnapshots).toEqual([]);
    events[0] = { ...events[0], finished: true, is_current: false, data_checked: true };
    events[1] = { ...events[1], finished: true, is_current: false, data_checked: true };
    events[2] = { ...events[2], is_current: true };

    const synced = await request(app.getHttpServer()).post('/api/team/sync')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(synced.body.scores).toEqual([]);
    expect(synced.body.totalScore).toBe(0);
    expect(synced.body.seasonScore).toBe(0);
    expect(synced.body.members[0]).toMatchObject({
      fplId: managerIds[0], currentGameweek: 3, currentGameweekPoints: 0, totalPoints: 1016,
    });

    const secondSynced = await request(app.getHttpServer()).post('/api/team/sync')
      .set('Authorization', `Bearer ${secondLogin.body.accessToken}`).expect(200);
    const thirdSynced = await request(app.getHttpServer()).post('/api/team/sync')
      .set('Authorization', `Bearer ${thirdLogin.body.accessToken}`).expect(200);
    expect(secondSynced.body.scores).toEqual([]);
    expect(secondSynced.body.totalScore).toBe(0);
    expect(thirdSynced.body.scores).toEqual([]);
    expect(thirdSynced.body.totalScore).toBe(0);

    // Earlier gameweeks must not contribute to season standings, even with stored points.
    await db.users.updateOne({ fplId: 72021 }, { $push: { scoreHistory: {
      gw: 6, points: 999, total: 1105, managerIds, captainId: managerIds[0],
      teamName: 'Excluded gameweek', capturedAt: new Date(),
    } } });
    events[2] = { ...events[2], id: 6 };
    const beforeSeason = await request(app.getHttpServer()).get('/api/team/standings?leagueFplId=999001')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(beforeSeason.body.every((row: { seasonScore: number }) => row.seasonScore === 0)).toBe(true);
    const beforeSeasonTeam = await request(app.getHttpServer()).get('/api/team')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(beforeSeasonTeam.body.seasonScore).toBe(0);
    expect(beforeSeasonTeam.body.members[0].currentGameweekPoints).toBe(0);

    for (const [fplId, points] of [[72021, 42], [72022, 21], [72023, 30]]) {
      await db.users.updateOne({ fplId }, { $push: { scoreHistory: {
        gw: 7, points, total: points, managerIds: [], captainId: 1,
        teamName: 'GW 7 test score', capturedAt: new Date(),
      } } });
    }
    events[2] = { ...events[2], id: 7 };
    const standings = await request(app.getHttpServer()).get('/api/team/standings?leagueFplId=999001')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(standings.body).toEqual([
      expect.objectContaining({ rank: 1, ownerFplId: 72021, teamName: 'Five managers', gw: 7, gwScore: 36, seasonScore: 78 }),
      expect.objectContaining({ rank: 2, ownerFplId: 72023, teamName: 'FML Third', gw: 7, gwScore: 20, seasonScore: 50 }),
      expect.objectContaining({ rank: 3, ownerFplId: 72022, teamName: 'FML Runner Up', gw: 7, gwScore: 16, seasonScore: 37 }),
    ]);

    events[2] = { ...events[2], id: 3 };
    const user = await db.users.findOne({ fplId: 72021 }).lean();
    expect(user?.team?.managerIds).toEqual(managerIds);
    expect(user?.team?.firstScoringGw).toBe(7);
    expect(user?.team?.pendingSnapshots.map((snapshot) => snapshot.gw)).toEqual([]);
    await db.users.updateOne({ fplId: 72021 }, { $pull: { 'team.pendingSnapshots': { gw: 3 } } });
    await request(app.getHttpServer()).post('/api/team/sync')
      .set('Authorization', `Bearer ${token}`).expect(200);
    const resnapshotted = await db.users.findOne({ fplId: 72021 }).lean();
    expect(resnapshotted?.team?.pendingSnapshots.map((snapshot) => snapshot.gw)).toEqual([]);
    events[2] = { ...events[2], deadline_time: '2020-01-15T12:00:00Z', finished: false, is_current: true };
    const lockedView = await request(app.getHttpServer()).get('/api/team').set('Authorization', `Bearer ${token}`).expect(200);
    expect(lockedView.body.editsLocked).toBe(true);
    await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Locked edit', leagueFplId: 999001, managerIds, captainId: managerIds[0] }).expect(409);
    events[2] = { ...events[2], finished: true, is_current: false, data_checked: true };
    const unlockedView = await request(app.getHttpServer()).get('/api/team').set('Authorization', `Bearer ${token}`).expect(200);
    expect(unlockedView.body.editsLocked).toBe(false);
    const collections = (await db.connection.db!.listCollections().toArray()).map((item) => item.name);
    expect(collections).toEqual(['users']);
  });

  it('validates password registration and login and no longer exposes legacy routes', async () => {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ fplId: 0, password: 'correct horse battery staple' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ fplId: 72021, password: 'correct horse battery staple' }).expect(409);
    await request(app.getHttpServer()).post('/api/auth/login').send({ fplId: 72021 }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/fpl/login').send({ fplId: 72021 }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/fpl/challenge').send({ fplId: 72021 }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/fpl/verify').send({}).expect(404);
    await request(app.getHttpServer()).get('/api/leagues').expect(404);
    await request(app.getHttpServer()).get('/api/rankings/overall').expect(404);
    await request(app.getHttpServer()).put('/api/team').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Invalid squad', leagueFplId: 999001, managerIds: [1, 2, 3, 4], captainId: 1 }).expect(400);
  });

  it('uses the JWT session for the embedded user document', async () => {
    const me = await request(app.getHttpServer()).get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toMatchObject({ fplId: 72021, totalScore: 42, team: { format: 5, firstScoringGw: 7 } });
    expect(me.body.scoreHistory.map((score: { gw: number }) => score.gw)).toEqual([7]);
    await request(app.getHttpServer()).get('/api/team').set('Authorization', `Bearer ${token}`).expect(200);
    const jwt = app.get(JwtService);
    expect(jwt).toBeDefined();
  });

  it('protects and runs the scheduled score sync endpoint', async () => {
    await request(app.getHttpServer()).get('/api/cron/sync')
      .set('Authorization', 'Bearer invalid-cron-secret').expect(403);
    const response = await request(app.getHttpServer()).get('/api/cron/sync')
      .set('Authorization', 'Bearer integration-cron-secret').expect(200);
    expect(response.body.updatedUsers).toBe(3);
  });

  it('preserves sale gains across transfers and applies subsequent losses with a 25M floor', async () => {
    const original = await db.users.findOne({ fplId: 72021 }).lean();
    const user = await db.users.create({
      fplId: 72024, firstName: 'Transfer', lastName: 'Test', fplTeamName: 'Transfers',
      passwordHash: 'unused-test-hash', team: original!.team, scoreHistory: [], totalScore: 0,
    });
    const teams = app.get(TeamService);
    const managerIds = [90000001, 90000017, 90000018, 90000019, 90000020];
    leagueManagers[15].rank = 1;
    try {
      const saved = await teams.save(user._id.toString(), {
        name: 'Transfer team', leagueFplId: 999001, managerIds, captainId: managerIds[0],
      });
      expect(saved).toMatchObject({ budget: 321, transferCapital: 321, spent: 168 });
      const again = await teams.save(user._id.toString(), {
        name: 'Transfer team', leagueFplId: 999001, managerIds, captainId: managerIds[0],
      });
      expect(again.budget).toBe(321);
      leagueManagers[0].rank = 2;
      expect((await teams.mine(user._id.toString())).budget).toBe(316);
      leagueManagers[0].rank = 20;
      expect((await teams.mine(user._id.toString())).budget).toBe(250);
    } finally {
      leagueManagers[0].rank = 1;
      leagueManagers[15].rank = 16;
    }
  });
});
