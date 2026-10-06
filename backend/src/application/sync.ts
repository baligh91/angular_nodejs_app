import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ClientSession, Types } from 'mongoose';
import { Config } from '../infrastructure/config';
import { Database, League } from '../infrastructure/database';
import { FplClient, FplEvent } from '../infrastructure/fpl';
import { initialPrice, nextPrice, priceDeltas, teamPoints } from '../domain/rules';
import { TeamService, objectId } from './teams';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  constructor(
    private readonly db: Database, private readonly fpl: FplClient,
    private readonly config: Config, private readonly teams: TeamService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    if (!this.config.syncEnabled) return;
    try { await this.sync(); } catch (error) { this.logger.error((error as Error).message); }
  }

  // Snapshot candidates are already persisted on every team edit; this also discovers new official GWs.
  @Cron(CronExpression.EVERY_MINUTE)
  async snapshots() {
    if (!this.config.syncEnabled) return;
    try {
      await this.db.transaction(async (session) => {
        const now = new Date();
        const future = await this.db.gameweeks.find({ deadline: { $gt: now }, finished: false }).session(session);
        if (!future.length) return;
        for (const team of await this.db.teams.find().session(session)) await this.teams.captureTeam(team, session, now);
        if (Date.now() >= Math.min(...future.map((gw) => gw.deadline.getTime()))) {
          throw new ConflictException('Deadline reached during snapshot capture');
        }
        await this.db.gameweeks.updateMany({ _id: { $in: future.map((gw) => gw._id) } },
          { $set: { snapshotsCaptured: true } }, { session });
      });
    } catch (error) { this.logger.error((error as Error).message); }
  }

  private async locked<T>(work: (owner: string) => Promise<T>) {
    const collection = this.db.connection.collection('operations');
    const owner = randomUUID();
    try {
      await collection.updateOne({
        key: 'sync-lock', $or: [{ until: { $lt: new Date() } }, { until: { $exists: false } }],
      }, { $set: { owner, until: new Date(Date.now() + 30 * 60000) } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('A synchronization is already running');
      throw error;
    }
    const heartbeat = setInterval(() => {
      collection.updateOne({ key: 'sync-lock', owner }, { $set: { until: new Date(Date.now() + 30 * 60000) } })
        .catch((error) => this.logger.error(`Sync lease renewal failed: ${error.message}`));
    }, 60000);
    try { return await work(owner); }
    finally {
      clearInterval(heartbeat);
      await collection.deleteOne({ key: 'sync-lock', owner });
    }
  }

  private async assertLease(owner: string, session: ClientSession) {
    const result = await this.db.connection.collection('operations').updateOne({
      key: 'sync-lock', owner, until: { $gt: new Date() },
    }, { $set: { until: new Date(Date.now() + 30 * 60000) } }, { session });
    if (!result.matchedCount) throw new ConflictException('Synchronization lease expired');
  }

  async importLeague(fplId: number) {
    return this.locked(async (owner) => {
      const events = await this.fpl.bootstrap();
      await this.bootstrap(events, owner);
      const league = await this.db.leagues.findOneAndUpdate({ fplId }, {
        $setOnInsert: {
          name: `FPL ${fplId}`, importedAt: new Date(),
          pricingFromGw: Math.max(0, ...events.filter((gw) => gw.finished && gw.data_checked).map((gw) => gw.id)) + 1,
        },
      }, { upsert: true, new: true });
      await this.syncLeague(league, owner);
      await this.processFinished(league._id, owner);
      const updated = await this.db.leagues.findById(league._id);
      return { id: league._id.toString(), fplId, name: updated!.name };
    });
  }

  async sync() {
    return this.locked(async (owner) => {
      await this.bootstrap(await this.fpl.bootstrap(), owner);
      const leagues = await this.db.leagues.find({ active: true });
      for (const league of leagues) {
        await this.syncLeague(league, owner);
        await this.processFinished(league._id, owner);
      }
      return { message: 'Synchronization completed', leagues: leagues.length };
    });
  }

  async setLeagueActive(id: string, active: boolean) {
    const leagueId = objectId(id);
    return this.locked(async (owner) => this.db.transaction(async (session) => {
      await this.assertLease(owner, session);
      const league = await this.db.leagues.findOneAndUpdate({ _id: leagueId }, {
        $set: { active },
      }, { new: true, session });
      if (!league) throw new NotFoundException('League not found');
      if (active && !league.lastSyncedAt) throw new ConflictException('Import must complete before activation');
      return { id: league._id.toString(), fplId: league.fplId, name: league.name, active: league.active };
    }));
  }

  private async bootstrap(events: FplEvent[], owner: string) {
    await this.db.transaction(async (session) => {
      await this.assertLease(owner, session);
      for (const event of events) {
        await this.db.gameweeks.updateOne({ id: event.id }, { $set: {
          deadline: new Date(event.deadline_time), finished: event.finished,
          current: event.is_current, dataChecked: event.data_checked,
        } }, { upsert: true, session });
      }
      const now = new Date();
      for (const team of await this.db.teams.find().session(session)) await this.teams.captureTeam(team, session, now);
    });
  }

  private async syncLeague(league: League, owner: string) {
    const standings = await this.fpl.standings(league.fplId);
    const existing = await this.db.managers.find({ leagueId: league._id });
    const entries = [...new Set([...standings.managers.map((m) => m.entry), ...existing.map((m) => m.fplId)])];
    const histories = new Map<number, Awaited<ReturnType<FplClient['history']>>>();
    // Four concurrent requests keep imports bounded without flooding the upstream.
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(entries.slice(offset, offset + 4).map(async (id) => histories.set(id, await this.fpl.history(id))));
    }
    await this.db.transaction(async (session) => {
      await this.assertLease(owner, session);
      await this.db.managers.updateMany({ leagueId: league._id }, { $set: { active: false } }, { session });
      const finished = await this.db.gameweeks.find({ finished: true, dataChecked: true }).session(session);
      const lastGw = Math.max(0, ...finished.map((gw) => gw.id));
      const current = await this.db.gameweeks.findOne({ current: true }).session(session);
      for (const id of entries) {
        const standing = standings.managers.find((m) => m.entry === id);
        const history = histories.get(id)!.map((h) => ({ gw: h.event, points: h.points, rank: h.overall_rank }));
        const completed = history.filter((h) => h.gw <= lastGw).sort((a, b) => a.gw - b.gw).slice(-5);
        const form = completed.length ? completed.reduce((sum, h) => sum + h.points, 0) / completed.length : 0;
        const manager = await this.db.managers.findOneAndUpdate({ leagueId: league._id, fplId: id }, {
          $set: {
            name: standing?.player_name || existing.find((m) => m.fplId === id)!.name,
            rank: standing?.rank || existing.find((m) => m.fplId === id)!.rank,
            gwPoints: history.find((h) => h.gw === current?.id)?.points ?? standing?.event_total ?? 0,
            form, history, active: Boolean(standing),
          },
          $setOnInsert: { price: standing ? initialPrice(standing.rank, standings.managers.length)
            : existing.find((m) => m.fplId === id)!.price },
        }, { upsert: true, new: true, session });
        await this.db.prices.updateOne({ managerId: manager._id, gw: 0 }, {
          $setOnInsert: { leagueId: league._id, price: manager.price, delta: 0 },
        }, { upsert: true, session });
      }
      await this.db.leagues.updateOne({ _id: league._id }, {
        $set: { name: standings.name, active: true, lastSyncedAt: new Date() },
      }, { session });
    });
  }

  private async processFinished(leagueId: Types.ObjectId, owner: string) {
    const gameweeks = await this.db.gameweeks.find({ finished: true, dataChecked: true }).sort({ id: 1 });
    for (const gw of gameweeks) {
      await this.db.transaction(async (session) => {
        await this.assertLease(owner, session);
        const key = `processed:${leagueId}:${gw.id}`;
        const operations = this.db.connection.collection('operations');
        if (await operations.findOne({ key }, { session })) return;
        const league = await this.db.leagues.findById(leagueId).session(session);
        if (!league) throw new NotFoundException('League not found');
        const managers = await this.db.managers.find({ leagueId }).session(session);
        const scores = await this.db.scores.find({
          leagueId, gw: gw.id, capturedAt: { $lt: gw.deadline }, scored: false,
        }).session(session);
        if (scores.some((score) => score.managerIds.some((id) =>
          !managers.some((manager) => manager._id.equals(id) && manager.history.some((h) => h.gw === gw.id))))) {
          throw new ConflictException(`Manager histories for GW ${gw.id} are not yet available`);
        }
        const points = new Map(managers.map((m) => [m._id.toString(), m.history.find((h) => h.gw === gw.id)?.points ?? 0]));
        for (const score of scores) {
          await this.db.scores.updateOne({ _id: score._id, scored: false }, { $set: {
            points: teamPoints(score.managerIds.map(String), score.captainId.toString(), points), scored: true,
          } }, { session });
        }
        if (gw.id >= league.pricingFromGw) {
          const eligible = managers.filter((m) => m.active);
          if (eligible.some((m) => !m.history.some((h) => h.gw === gw.id))) {
            throw new ConflictException(`Price histories for GW ${gw.id} are not yet available`);
          }
          const performance = eligible.map((m) => {
            const last = m.history.filter((h) => h.gw <= gw.id).sort((a, b) => a.gw - b.gw).slice(-5);
            return {
              id: m._id.toString(), gwPoints: points.get(m._id.toString())!,
              form: last.length ? last.reduce((sum, h) => sum + h.points, 0) / last.length : 0,
            };
          });
          const deltas = priceDeltas(performance);
          for (const manager of eligible) {
            const delta = deltas.get(manager._id.toString())!;
            const price = nextPrice(manager.price, delta);
            await this.db.prices.create([{ leagueId, managerId: manager._id, gw: gw.id, price,
              delta: price - manager.price }], { session });
            await this.db.managers.updateOne({ _id: manager._id }, { $set: { price } }, { session });
          }
        }
        await this.rank(leagueId, gw.id, session);
        await this.rank(leagueId, 0, session);
        await operations.insertOne({ key, completedAt: new Date() }, { session });
      });
    }
  }

  private async rank(leagueId: Types.ObjectId, gw: number, session: ClientSession) {
    const scores = await this.db.scores.find({
      leagueId, scored: true, ...(gw ? { gw } : {}),
    }).sort({ gw: 1 }).session(session);
    const totals = new Map<string, { teamId: Types.ObjectId; teamName: string; pseudo: string; points: number }>();
    for (const score of scores) {
      const key = score.teamId.toString();
      const previous = totals.get(key);
      totals.set(key, { teamId: score.teamId, teamName: score.teamName,
        pseudo: score.pseudo, points: (previous?.points || 0) + score.points });
    }
    const sorted = [...totals.values()].sort((a, b) => b.points - a.points
      || a.teamId.toString().localeCompare(b.teamId.toString()));
    const historical = gw ? await this.db.scores.find({ leagueId, scored: true, gw: { $lte: gw } })
      .session(session).lean() : [];
    const prices = gw ? await this.db.prices.find({ leagueId, gw: { $lte: gw } })
      .sort({ gw: 1 }).session(session).lean() : [];
    const historicalPrices = new Map(prices.map((price) => [price.managerId.toString(), price.price]));
    const historicalTotals = new Map<string, number>();
    for (const score of historical) {
      const key = score.teamId.toString();
      historicalTotals.set(key, (historicalTotals.get(key) ?? 0) + score.points);
    }
    await this.db.rankings.deleteMany({ leagueId, gw }).session(session);
    let rank = 0;
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index];
      if (!index || row.points !== sorted[index - 1].points) rank = index + 1;
      await this.db.rankings.create([{ leagueId, gw, rank, ...row }], { session });
      if (gw) {
        const score = scores.find((score) => score.teamId.equals(row.teamId))!;
        const overallPoints = historicalTotals.get(row.teamId.toString())!;
        const overallRank = 1 + [...historicalTotals.values()].filter((points) => points > overallPoints).length;
        const teamValue = score.managerIds.reduce((sum, id) => {
          const price = historicalPrices.get(id.toString());
          if (price === undefined) throw new ConflictException(`Historical price unavailable for GW ${gw}`);
          return sum + price;
        }, 0);
        await this.db.scores.updateOne({ _id: score._id }, {
          $set: { overallPoints, rank: overallRank, teamValue },
        }, { session });
      }
      if (!gw) await this.db.teams.updateOne({ _id: row.teamId }, {
        $set: { points: row.points, rank },
      }, { session });
    }
  }

  async rankings(league?: string, gw = 0) {
    if (league === undefined) {
      const scores = await this.db.scores.find({ scored: true, ...(gw ? { gw } : {}) })
        .sort({ gw: 1, teamId: 1 }).lean();
      const totals = new Map<string, { teamId: string; teamName: string; pseudo: string; points: number }>();
      for (const score of scores) {
        const teamId = score.teamId.toString();
        totals.set(teamId, {
          teamId, teamName: score.teamName, pseudo: score.pseudo,
          points: (totals.get(teamId)?.points ?? 0) + score.points,
        });
      }
      const sorted = [...totals.values()].sort((a, b) => b.points - a.points || a.teamId.localeCompare(b.teamId));
      let rank = 0;
      return sorted.map((row, index) => {
        if (!index || row.points !== sorted[index - 1].points) rank = index + 1;
        return { rank, ...row };
      });
    }
    return (await this.db.rankings.find({ leagueId: objectId(league), gw }).sort({ rank: 1, teamId: 1 }).lean())
      .map((row) => ({ rank: row.rank, teamId: row.teamId.toString(), teamName: row.teamName,
        pseudo: row.pseudo, points: row.points }));
  }
}
