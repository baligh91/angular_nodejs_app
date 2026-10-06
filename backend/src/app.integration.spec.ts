import 'reflect-metadata';
import { INestApplication, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { Database } from './infrastructure/database';
import { FplClient, FplEvent, FplProfile } from './infrastructure/fpl';
import { AuthService } from './application/auth';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { SyncService } from './application/sync';
import mongoose, { Types } from 'mongoose';
import { seedFixtures, FIXTURE_LEAGUE_ID, FIXTURE_TEAM_ID, fixtureManagerId } from './infrastructure/fixtures';

describe('FML HTTP + Mongo replica-set integration', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  let db: Database;
  let token: string;
  let admin: string;
  let cookie: string;
  const entryNames = new Map<number, string>();
  const entryProfile = (id: number): FplProfile => ({
    id, firstName: id === 90000001 ? 'Admin' : 'Joueur', lastName: 'démo',
    teamName: entryNames.get(id) ?? 'Team without proof', overallPoints: 260,
    overallRank: 1, gameweekPoints: 260, gameweekRank: 1,
    favoriteTeam: { id: 1, name: 'Arsenal' }, leagues: [{ id: 999001, name: 'FML demonstration', rank: 1 }],
  });
  let events: FplEvent[];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'integration-only-secret-at-least-32-characters';
    process.env.SYNC_ENABLED = 'false';
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_FPL_IDS = '90000001';
    process.env.MONGOMS_DOWNLOAD_DIR = `${process.cwd()}\\.mongodb-binaries`;
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
    process.env.MONGODB_URI = mongo.getUri('fml');
    const legacyConnection = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
    try { await legacyConnection.collection('users').createIndex({ email: 1 }, { unique: true }); }
    finally { await legacyConnection.close(); }
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
    db = app.get(Database);
    expect(await db.connection.collection('users').indexExists('email_1')).toBe(false);
    await seedFixtures(db);
    events = [
      { id: 1, deadline_time: '2020-01-01T12:00:00Z', finished: true, is_current: false, data_checked: true },
      { id: 2, deadline_time: '2099-01-01T12:00:00Z', finished: false, is_current: true, data_checked: false },
      { id: 3, deadline_time: '2099-01-08T12:00:00Z', finished: false, is_current: false, data_checked: false },
    ];
    const fpl = app.get(FplClient);
    jest.spyOn(fpl, 'entry').mockImplementation(async (id) => entryProfile(id));
    jest.spyOn(fpl, 'bootstrap').mockImplementation(async () => events);
    jest.spyOn(fpl, 'standings').mockImplementation(async () => ({
      name: 'Integration league', managers: Array.from({ length: 20 }, (_, i) => ({
        entry: 90000001 + i, player_name: `Manager ${i + 1}`, rank: i + 1, event_total: 90 - i,
      })),
    }));
    jest.spyOn(fpl, 'history').mockImplementation(async (id) => [
      { event: 1, points: 80 - (id - 90000000) * 2, overall_rank: id },
      { event: 2, points: 90 - (id - 90000001), overall_rank: id },
    ]);
    const challenge = await request(app.getHttpServer()).post('/api/auth/fpl/challenge')
      .send({ fplId: 90000020 }).expect(200);
    expect(challenge.body).toMatchObject({ profile: { id: 90000020, leagues: [{ id: 999001 }] } });
    entryNames.set(90000020, challenge.body.code);
    const login = await request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: challenge.body.challengeId }).expect(200);
    token = login.body.accessToken;
    cookie = login.headers['set-cookie'][0].split(';')[0];
    const adminChallenge = await request(app.getHttpServer()).post('/api/auth/fpl/challenge')
      .send({ fplId: 90000001 }).expect(200);
    entryNames.set(90000001, adminChallenge.body.code);
    admin = (await request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: adminChallenge.body.challengeId }).expect(200)).body.accessToken;
  });
  afterAll(async () => { await app?.close(); await mongo?.stop(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const adminAuth = () => ({ Authorization: `Bearer ${admin}` });
  const payload = () => ({
    name: 'Edited team', leagueId: FIXTURE_LEAGUE_ID, format: 5,
    managerIds: [16, 17, 18, 19, 20].map(fixtureManagerId), captainId: fixtureManagerId(16),
  });

  it('exposes health/docs, requires authorization, and returns contract projections', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    await request(app.getHttpServer()).get('/api/leagues').expect(401);
    const leagues = await request(app.getHttpServer()).get('/api/leagues').set(auth()).expect(200);
    expect(leagues.body[0].id).toBe(FIXTURE_LEAGUE_ID);
    const managers = await request(app.getHttpServer()).get(`/api/managers?leagueId=${FIXTURE_LEAGUE_ID}`)
      .set(auth()).expect(200);
    expect(managers.body).toHaveLength(20);
    expect(managers.body[19].price).toBe(10);
    const mine = await request(app.getHttpServer()).get('/api/teams/mine').set(auth()).expect(200);
    expect(mine.body[0].members).toHaveLength(5);
  });
  it('rotates refresh tokens and rejects replay, unknown fields, and untrusted origins', async () => {
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie)
      .set('Origin', 'https://evil.invalid').expect(403);
    const refresh = await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    token = refresh.body.accessToken;
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    cookie = refresh.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth()).send({ role: 'admin' }).expect(400);
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth())
      .send({ favoriteTeam: 'Arsenal' }).expect(400);
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth()).send({ pseudo: 'Reassigned' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/fpl/sync').set(auth()).send({ fplId: 90000001 }).expect(400);
    const synced = await request(app.getHttpServer()).post('/api/auth/fpl/sync').set(auth()).send({}).expect(200);
    expect(synced.body).toMatchObject({ fplId: 90000020, favoriteTeam: 'Arsenal', fplProfile: { id: 90000020 } });
    expect(synced.body).not.toHaveProperty('email');
    const cleared = await request(app.getHttpServer()).patch('/api/auth/me').set(auth())
      .send({ avatar: null }).expect(200);
    expect(cleared.body).toMatchObject({ avatar: null });
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth())
      .send({ avatar: 'http://example.com/avatar.png' }).expect(400);
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth())
      .send({ avatar: 'https://example.com/avatar.png' }).expect(200);
    await request(app.getHttpServer()).patch('/api/auth/me').set(auth()).send({}).expect(200);
    expect((await request(app.getHttpServer()).get('/api/auth/me').set(auth()).expect(200)).body)
      .toMatchObject({ avatar: 'https://example.com/avatar.png', favoriteTeam: 'Arsenal' });
    const blank = await request(app.getHttpServer()).patch('/api/auth/me').set(auth())
      .send({ avatar: '' }).expect(200);
    expect(blank.body).toMatchObject({ avatar: null });
  });
  it('enforces administrator and ownership authorization', async () => {
    await request(app.getHttpServer()).post('/api/admin/sync').set(auth()).expect(403);
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(adminAuth()).send(payload()).expect(404);
    const users = await request(app.getHttpServer()).get('/api/admin/users').set(adminAuth()).expect(200);
    expect(users.body).toHaveLength(2);
    expect(users.body[0]).not.toHaveProperty('passwordHash');
  });
  it('requires fresh exact FPL ownership proof and rejects replay, expiry and concurrent consumption', async () => {
    const service = app.get(AuthService);
    const fplId = 12345;
    const challenge = await service.challenge(fplId);
    expect(challenge.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge.code).toMatch(/^FML-[A-F0-9]{16}$/);
    expect(challenge.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60000);
    expect(await db.challenges.findOne({ challengeHash: createHash('sha256').update(challenge.challengeId).digest('hex') }))
      .not.toHaveProperty('code');
    entryNames.set(67890, challenge.code);
    await request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: challenge.challengeId }).expect(401);
    for (const wrong of [`prefix${challenge.code}`, `${challenge.code}suffix`,
      `[${challenge.code}]`, `Team ${challenge.code}`]) {
      entryNames.set(fplId, wrong);
      await request(app.getHttpServer()).post('/api/auth/fpl/verify')
        .send({ challengeId: challenge.challengeId }).expect(401);
    }
    jest.spyOn(app.get(FplClient), 'entry').mockRejectedValueOnce(new ServiceUnavailableException('FPL unavailable'));
    await request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: challenge.challengeId }).expect(503);
    entryNames.set(fplId, challenge.code);
    const results = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: challenge.challengeId })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    expect(results.find((result) => result.status === 200)!.body.user)
      .toMatchObject({ fplId, role: 'user', fplProfile: { id: fplId } });
    expect(await db.users.countDocuments({ fplId })).toBe(1);
    await request(app.getHttpServer()).post('/api/auth/fpl/verify')
      .send({ challengeId: challenge.challengeId }).expect(401);
    const verified = results.find((result) => result.status === 200)!;
    const verifiedCookie = verified.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', verifiedCookie).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me')
      .set('Authorization', `Bearer ${verified.body.accessToken}`).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', verifiedCookie).expect(401);
    const expired = await service.challenge(fplId);
    await db.challenges.updateOne({ fplId, consumedAt: { $exists: false } }, { $set: { expiresAt: new Date(0) } });
    await expect(service.verifyChallenge(expired.challengeId)).rejects.toThrow('expired');
    const exhausted = await service.challenge(fplId);
    entryNames.set(fplId, 'no code');
    for (let i = 0; i < 10; i++) await expect(service.verifyChallenge(exhausted.challengeId)).rejects.toThrow('exact verification code');
    entryNames.set(fplId, exhausted.code);
    await expect(service.verifyChallenge(exhausted.challengeId)).rejects.toThrow('exhausted');
    await db.users.deleteOne({ fplId });
  });
  it('revokes prior sessions when an existing FPL identity verifies ownership again', async () => {
    const service = app.get(AuthService);
    const id = 333333;
    const connect = async () => {
      const challenge = await service.challenge(id);
      entryNames.set(id, challenge.code);
      return service.verifyChallenge(challenge.challengeId);
    };
    try {
      const first = await connect();
      const second = await connect();
      expect(second.body.user.id).toBe(first.body.user.id);
      await request(app.getHttpServer()).get('/api/auth/me')
        .set('Authorization', `Bearer ${first.body.accessToken}`).expect(401);
      await expect(service.refresh(first.refreshToken)).rejects.toThrow('Invalid refresh token');
      await request(app.getHttpServer()).get('/api/auth/me')
        .set('Authorization', `Bearer ${second.body.accessToken}`).expect(200);
    } finally { await db.users.deleteOne({ fplId: id }); }
  });
  it('rejects invalid challenge requests and removes all previous password-based routes', async () => {
    await request(app.getHttpServer()).post('/api/auth/fpl/challenge').send({ fplId: 0 }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/fpl/challenge').send({ fplId: 1, role: 'admin' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/fpl/verify').send({ challengeId: 'guess' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/fpl/verify').set('Origin', 'https://evil.invalid')
      .send({ challengeId: 'A'.repeat(43) }).expect(403);
    for (const route of ['login', 'register', 'forgot-password', 'reset-password']) {
      await request(app.getHttpServer()).post(`/api/auth/${route}`).send({}).expect(404);
    }
    jest.spyOn(app.get(FplClient), 'entry').mockRejectedValueOnce(new NotFoundException('FPL entry not found'));
    await request(app.getHttpServer()).post('/api/auth/fpl/challenge').send({ fplId: 999999 }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/fpl/challenge').send({ fplId: 999999 }).expect(429);
    // HTTP challenge limits remain real; verify upstream-not-found independently.
    jest.spyOn(app.get(FplClient), 'entry').mockRejectedValueOnce(new NotFoundException('FPL entry not found'));
    await expect(app.get(AuthService).challenge(999999)).rejects.toThrow('FPL entry not found');
  });
  it('does not link legacy accounts, reuse their privileges or accept their sessions', async () => {
    const legacyId = new Types.ObjectId();
    const refresh = 'legacy-refresh-secret';
    await db.connection.collection('users').insertOne({
      _id: legacyId, email: 'legacy@example.invalid', passwordHash: 'legacy-unused', pseudo: 'Legacy admin',
      role: 'admin', disabled: false, tokenVersion: 0,
      refreshHash: createHash('sha256').update(refresh).digest('hex'), refreshExpires: new Date(Date.now() + 60000),
    });
    const legacyToken = app.get(JwtService).sign({ sub: legacyId.toString(), ver: 0 }, {
      secret: process.env.JWT_SECRET, issuer: 'fml', audience: 'fml-web', expiresIn: '15m',
    });
    try {
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${legacyToken}`).expect(401);
      await expect(app.get(AuthService).refresh(`${legacyId}.${refresh}`)).rejects.toThrow('Invalid refresh token');
      await db.connection.collection('users').updateOne({ _id: legacyId }, { $set: { fplId: 888888 } });
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${legacyToken}`).expect(401);
      await expect(app.get(AuthService).refresh(`${legacyId}.${refresh}`)).rejects.toThrow('Invalid refresh token');
      await db.connection.collection('users').updateOne({ _id: legacyId }, { $unset: { fplId: 1 } });
      const challenge = await app.get(AuthService).challenge(777777);
      entryNames.set(777777, challenge.code);
      const session = await app.get(AuthService).verifyChallenge(challenge.challengeId);
      expect(session.body.user).toMatchObject({ fplId: 777777, role: 'user' });
      expect(session.body.user.id).not.toBe(legacyId.toString());
      expect(session.body.user).not.toHaveProperty('email');
      expect((await db.connection.collection('users').findOne({ _id: legacyId }))!.fplId).toBeUndefined();
    } finally {
      await db.connection.collection('users').deleteOne({ _id: legacyId });
      await db.users.deleteOne({ fplId: 777777 });
    }
  });
  it('allows authenticated users to import public FPL leagues with validated identifiers', async () => {
    await request(app.getHttpServer()).post('/api/leagues').send({ fplId: 999001 }).expect(401);
    await request(app.getHttpServer()).post('/api/leagues').set(auth()).send({ fplId: '999001' }).expect(400);
    const imported = await request(app.getHttpServer()).post('/api/leagues').set(auth())
      .send({ fplId: 999001 }).expect(201);
    expect(imported.body).toEqual({ id: FIXTURE_LEAGUE_ID, fplId: 999001, name: 'Integration league' });
    expect(app.get(FplClient).standings).toHaveBeenCalledWith(999001);
    expect(await db.managers.countDocuments({ leagueId: FIXTURE_LEAGUE_ID, active: true })).toBe(20);
  });
  it('keeps the real admin synchronization rate limiter separate from settlement tests', async () => {
    // The forbidden request above also consumes this per-IP endpoint bucket.
    await request(app.getHttpServer()).post('/api/admin/sync').set(adminAuth()).expect(200);
    await request(app.getHttpServer()).post('/api/admin/sync').set(adminAuth()).expect(429);
  });
  it('manages league activation with administrator authorization and strict validation', async () => {
    const url = `/api/admin/leagues/${FIXTURE_LEAGUE_ID}`;
    await request(app.getHttpServer()).patch(url).set(auth()).send({ active: false }).expect(403);
    await request(app.getHttpServer()).patch(url).set(adminAuth()).send({ active: 'false' }).expect(400);
    await request(app.getHttpServer()).patch(url).set(adminAuth()).send({ active: false, name: 'override' }).expect(400);
    await request(app.getHttpServer()).patch('/api/admin/leagues/invalid').set(adminAuth())
      .send({ active: false }).expect(400);
    await request(app.getHttpServer()).patch(`/api/admin/leagues/${new Types.ObjectId()}`).set(adminAuth())
      .send({ active: false }).expect(404);
    const disabled = await request(app.getHttpServer()).patch(url).set(adminAuth()).send({ active: false }).expect(200);
    expect(disabled.body.active).toBe(false);
    expect((await request(app.getHttpServer()).get('/api/leagues').set(auth()).expect(200)).body).toEqual([]);
    await request(app.getHttpServer()).post('/api/teams').set(auth()).send(payload()).expect(404);
    expect((await app.get(SyncService).sync()).leagues).toBe(0);
    expect((await request(app.getHttpServer()).get('/api/admin/leagues').set(adminAuth()).expect(200))
      .body[0].active).toBe(false);
    await request(app.getHttpServer()).patch(url).set(adminAuth()).send({ active: true }).expect(200);
  });
  it('returns settled history only, validates IDs, and reconstructs legacy overall ranks and prices', async () => {
    const url = `/api/teams/${FIXTURE_TEAM_ID}/history`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get('/api/teams/invalid/history').set(auth()).expect(400);
    await request(app.getHttpServer()).get(`/api/teams/${new Types.ObjectId()}/history`).set(auth()).expect(404);
    const initial = (await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body;
    expect(initial).toEqual([{ gw: 1, points: 260, overallPoints: 260, rank: 1, teamValue: 97 }]);
    const original = await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 1 }).lean();
    await db.scores.updateOne({ _id: original!._id }, { $unset: { rank: 1, teamValue: 1, overallPoints: 1 } });
    const rival = await db.scores.create({
      ...original, _id: new Types.ObjectId(), teamId: new Types.ObjectId(), points: 300,
      rank: undefined, teamValue: undefined, overallPoints: undefined,
    });
    try {
      const history = (await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body;
      expect(history).toEqual([{ ...initial[0], rank: 2 }]);
      await db.scores.updateOne({ _id: rival._id }, { $set: { points: 260 } });
      expect((await request(app.getHttpServer()).get(url).set(auth()).expect(200)).body[0].rank).toBe(1);
      const price = await db.prices.findOne({ managerId: fixtureManagerId(16), gw: 0 }).lean();
      await db.prices.deleteOne({ _id: price!._id });
      try {
        await request(app.getHttpServer()).get(url).set(auth()).expect(409);
      } finally { await db.prices.create(price!); }
    } finally {
      await db.scores.deleteOne({ _id: rival._id });
      await db.scores.updateOne({ _id: original!._id }, {
        $set: { rank: original!.rank, teamValue: original!.teamValue, overallPoints: original!.overallPoints },
      });
    }
  });
  it('validates exact count, captain, distinct members and budget', async () => {
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), managerIds: [fixtureManagerId(16)] }).expect(400);
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), captainId: fixtureManagerId(1) }).expect(400);
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), managerIds: Array(5).fill(fixtureManagerId(20)) }).expect(400);
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), managerIds: [1, 2, 3, 4, 5].map(fixtureManagerId), captainId: fixtureManagerId(1) }).expect(400);
    await request(app.getHttpServer()).post('/api/teams').set(auth()).send(payload()).expect(409);
  });
  it('aggregates worldwide rankings across leagues with settled-only totals and competition ties', async () => {
    await request(app.getHttpServer()).get('/api/rankings/overall').expect(401);
    await request(app.getHttpServer()).get('/api/rankings/overall?leagueId=').set(auth()).expect(400);
    await request(app.getHttpServer()).get('/api/rankings/gw/1?leagueId=invalid').set(auth()).expect(400);
    await request(app.getHttpServer()).get('/api/managers').set(auth()).expect(400);
    const template = await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 1 }).lean();
    const leagueId = new Types.ObjectId();
    const firstTeam = new Types.ObjectId();
    const secondTeam = new Types.ObjectId();
    await db.scores.insertMany([
      { ...template, _id: new Types.ObjectId(), leagueId, teamId: firstTeam, teamName: 'Global first',
        points: 300, gw: 1 },
      { ...template, _id: new Types.ObjectId(), leagueId, teamId: firstTeam, teamName: 'Global first',
        points: -40, gw: 2 },
      { ...template, _id: new Types.ObjectId(), leagueId, teamId: secondTeam, teamName: 'Global second',
        points: 10, gw: 1 },
      { ...template, _id: new Types.ObjectId(), leagueId, teamId: secondTeam,
        points: 9999, gw: 2, scored: false },
    ]);
    try {
      const overall = (await request(app.getHttpServer()).get('/api/rankings/overall').set(auth()).expect(200)).body;
      expect(overall.map((row: { rank: number; points: number }) => ({ rank: row.rank, points: row.points })))
        .toEqual([{ rank: 1, points: 260 }, { rank: 1, points: 260 }, { rank: 3, points: 10 }]);
      expect(overall.slice(0, 2).map((row: { teamId: string }) => row.teamId))
        .toEqual([FIXTURE_TEAM_ID, firstTeam.toString()].sort());
      const gw = (await request(app.getHttpServer()).get('/api/rankings/gw/1').set(auth()).expect(200)).body;
      expect(gw.map((row: { rank: number; points: number }) => ({ rank: row.rank, points: row.points })))
        .toEqual([{ rank: 1, points: 300 }, { rank: 2, points: 260 }, { rank: 3, points: 10 }]);
      const filtered = (await request(app.getHttpServer()).get(`/api/rankings/overall?leagueId=${FIXTURE_LEAGUE_ID}`)
        .set(auth()).expect(200)).body;
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toMatchObject({ teamId: FIXTURE_TEAM_ID, rank: 1, points: 260 });
      expect((await request(app.getHttpServer()).get('/api/rankings/gw/99').set(auth()).expect(200)).body).toEqual([]);
    } finally { await db.scores.deleteMany({ leagueId }); }
  });
  it('captures edits before deadline, rejects during GW, scores and reprices only once', async () => {
    await app.get(SyncService).sync();
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth()).send(payload()).expect(200);
    const before = await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 2 }).lean();
    expect(before!.captainId.toString()).toBe(fixtureManagerId(16));
    events[1] = { ...events[1], deadline_time: new Date(Date.now() + 20).toISOString() };
    await db.gameweeks.updateOne({ id: 2 }, { $set: { deadline: new Date(events[1].deadline_time) } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), captainId: fixtureManagerId(20) }).expect(409);
    events[1] = { ...events[1], finished: true, data_checked: true };
    jest.spyOn(app.get(FplClient), 'history').mockImplementationOnce(async (id) => [
      { event: 1, points: 80 - (id - 90000000) * 2, overall_rank: id },
    ]);
    await expect(app.get(SyncService).sync()).rejects.toThrow('Price histories for GW 2 are not yet available');
    expect(await db.prices.countDocuments({ gw: 2 })).toBe(0);
    expect((await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 2 }))!.scored).toBe(false);
    expect(await db.connection.collection('operations').findOne({
      key: `processed:${FIXTURE_LEAGUE_ID}:2`,
    })).toBeNull();
    // A previously scored league team still contributes to historical overall rank,
    // even without a current-GW score; GW-only rankings remain independent.
    const previous = await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 1 }).lean();
    await db.scores.create({
      ...previous, _id: new Types.ObjectId(), teamId: new Types.ObjectId(), points: 800,
    });
    await app.get(SyncService).sync();
    const scored = await db.scores.findOne({ teamId: FIXTURE_TEAM_ID, gw: 2 }).lean();
    expect(scored!.captainId.toString()).toBe(fixtureManagerId(16));
    expect(scored!.points).toBe(440);
    const prices = await db.prices.find({ gw: 2 }).sort({ managerId: 1 }).lean();
    expect(prices).toHaveLength(20);
    expect(prices[0]).toMatchObject({ price: 102, delta: 2 });
    expect(prices[19]).toMatchObject({ price: 10, delta: 0 });
    const historyUrl = `/api/teams/${FIXTURE_TEAM_ID}/history`;
    const history = (await request(app.getHttpServer()).get(historyUrl).set(auth()).expect(200)).body;
    expect(history).toEqual([
      { gw: 1, points: 260, overallPoints: 260, rank: 1, teamValue: 97 },
      { gw: 2, points: 440, overallPoints: 700, rank: 2,
        teamValue: 92 },
    ]);
    expect(scored!.overallPoints).toBe(700);
    expect(scored!.rank).toBe(2);
    expect(scored!.teamValue).toBe(history[1].teamValue);
    await app.get(SyncService).sync();
    expect(await db.prices.countDocuments({ gw: 2 })).toBe(20);
    expect(await db.prices.find({ gw: 2 }).sort({ managerId: 1 }).lean()).toEqual(prices);
    expect((await request(app.getHttpServer()).get(historyUrl).set(auth()).expect(200)).body).toEqual(history);
    await db.scores.updateOne({ _id: scored!._id }, { $unset: { rank: 1, overallPoints: 1 } });
    expect((await request(app.getHttpServer()).get(historyUrl).set(auth()).expect(200)).body[1])
      .toMatchObject({ gw: 2, overallPoints: 700, rank: 2 });
    await db.scores.updateOne({ _id: scored!._id }, { $set: { rank: 2, overallPoints: 700 } });
    expect((await db.scores.findById(scored!._id))!.points).toBe(440);
    const ranking = await request(app.getHttpServer()).get(`/api/rankings/gw/2?leagueId=${FIXTURE_LEAGUE_ID}`)
      .set(auth()).expect(200);
    expect(ranking.body[0].points).toBe(440);
    expect(ranking.body[0].rank).toBe(1);
    // Post-GW edits change future candidates only, never the frozen scored snapshot.
    await request(app.getHttpServer()).put(`/api/teams/${FIXTURE_TEAM_ID}`).set(auth())
      .send({ ...payload(), managerIds: [15, 16, 17, 18, 19].map(fixtureManagerId),
        captainId: fixtureManagerId(19) }).expect(200);
    expect((await db.scores.findById(scored!._id))!.captainId.toString()).toBe(fixtureManagerId(16));
    expect((await db.scores.findById(scored!._id))!.managerIds.map(String)).toEqual(payload().managerIds);
    expect((await request(app.getHttpServer()).get(historyUrl).set(auth()).expect(200)).body).toEqual(history);
    const newTeam = await request(app.getHttpServer()).post('/api/teams').set(adminAuth()).send(payload()).expect(201);
    expect((await request(app.getHttpServer()).get(`/api/teams/${newTeam.body.id}/history`)
      .set(auth()).expect(200)).body).toEqual([]);
  });
  it('disables sessions immediately and rejects even valid ownership proof for disabled accounts', async () => {
    const user = await db.users.findOne({ fplId: 90000020 });
    await request(app.getHttpServer()).patch(`/api/admin/users/${user!._id}`).set(adminAuth())
      .send({ disabled: true }).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set(auth()).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    const challenge = await app.get(AuthService).challenge(90000020);
    entryNames.set(90000020, challenge.code);
    await expect(app.get(AuthService).verifyChallenge(challenge.challengeId)).rejects.toThrow('Account disabled');
  });
});
