import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Database, User } from '../infrastructure/database';
import { FplClient } from '../infrastructure/fpl';
import { firstScoringGameweek, scoreManagers } from './team';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  constructor(private readonly db: Database, private readonly fpl: FplClient) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync() {
    if (process.env.SYNC_ENABLED === 'false') return;
    try { await this.syncAll(); }
    catch (error) { this.logger.error((error as Error).message); }
  }

  async syncAll() {
    const events = (await this.fpl.bootstrap()).filter((event) => event.finished && event.data_checked);
    const users = await this.db.users.find({ 'team.managerIds.0': { $exists: true }, disabled: false });
    for (const user of users) await this.syncUser(user, events);
    return { updatedUsers: users.length };
  }

  async syncUser(user: User, events?: Awaited<ReturnType<FplClient['bootstrap']>>) {
    if (!user.team) return { scoresAdded: 0 };
    const currentEvents = events ?? await this.fpl.bootstrap();
    const initialFirstScoringGw = user.team.firstScoringGw ?? firstScoringGameweek(currentEvents);
    if (!user.team.firstScoringGw) {
      await this.db.users.updateOne({ _id: user._id }, { $set: { 'team.firstScoringGw': initialFirstScoringGw } });
      user.team.firstScoringGw = initialFirstScoringGw;
    }
    for (const event of currentEvents.filter((candidate) => candidate.id >= initialFirstScoringGw && !candidate.finished
      && Date.now() < Date.parse(candidate.deadline_time))) {
      if (user.team.pendingSnapshots?.some((snapshot) => snapshot.gw === event.id)) continue;
      await this.db.users.updateOne({
        _id: user._id, disabled: false, 'team.managerIds': user.team.managerIds,
        'team.captainId': user.team.captainId, 'team.name': user.team.name,
        'team.pendingSnapshots.gw': { $ne: event.id },
      }, { $push: { 'team.pendingSnapshots': {
        gw: event.id, managerIds: [...user.team.managerIds], captainId: user.team.captainId,
        teamName: user.team.name, capturedAt: new Date(),
      } } });
    }
    const latestUser = await this.db.users.findOne({ _id: user._id, disabled: false });
    if (!latestUser?.team) return { scoresAdded: 0 };
    const storedGameweeks = [
      ...(latestUser.scoreHistory ?? []).map((score) => score.gw),
      ...(latestUser.team.pendingSnapshots ?? []).map((snapshot) => snapshot.gw),
    ];
    const firstScoringGw = latestUser.team.firstScoringGw
      ?? (storedGameweeks.length ? Math.min(...storedGameweeks) : initialFirstScoringGw);
    if (!latestUser.team.firstScoringGw) {
      await this.db.users.updateOne({ _id: latestUser._id }, { $set: { 'team.firstScoringGw': firstScoringGw } });
      latestUser.team.firstScoringGw = firstScoringGw;
    }
    const completed = currentEvents.filter((event) => event.finished && event.data_checked);
    const pending = latestUser.team.pendingSnapshots || [];
    const managerIds = [...new Set(pending.flatMap((snapshot) => snapshot.managerIds))];
    const managerHistory = await Promise.all(managerIds.map(async (id) => [id, await this.fpl.history(id)] as const));
    const histories = new Map(managerHistory);
    let scoresAdded = 0;
    for (const event of completed) {
      const gw = event.id;
      if (gw < firstScoringGw) continue;
      if (latestUser.scoreHistory?.some((score) => score.gw === gw)) continue;
      const snapshot = pending.find((candidate) => candidate.gw === gw);
      if (!snapshot) continue;
      const points = new Map<number, number>();
      let ready = true;
      for (const id of snapshot.managerIds) {
        const score = histories.get(id)?.find((item) => item.event === gw);
        if (!score) { ready = false; break; }
        points.set(id, score.points);
      }
      if (!ready) continue;
      const totalScore = scoreManagers(snapshot.managerIds, snapshot.captainId, points);
      const scoreHistory = {
        gw, points: totalScore, total: latestUser.totalScore + totalScore,
        managerIds: [...snapshot.managerIds], captainId: snapshot.captainId,
        teamName: snapshot.teamName, capturedAt: snapshot.capturedAt,
      };
      const result = await this.db.users.updateOne({
        _id: latestUser._id, disabled: false, 'team.pendingSnapshots.gw': gw,
        'scoreHistory.gw': { $ne: gw },
      }, { $push: { scoreHistory }, $inc: { totalScore }, $pull: { 'team.pendingSnapshots': { gw } } });
      if (result.modifiedCount) {
        scoresAdded++;
        latestUser.scoreHistory.push(scoreHistory);
        latestUser.totalScore += totalScore;
      }
    }
    return { scoresAdded };
  }
}
