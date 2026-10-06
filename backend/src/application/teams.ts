import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { Database, Team } from '../infrastructure/database';
import { FORMATS, Format, NonexclusiveRecruitment } from '../domain/rules';

export function objectId(value: string) {
  if (!/^[a-f0-9]{24}$/i.test(value || '')) throw new BadRequestException('Invalid identifier');
  return new Types.ObjectId(value);
}

export interface TeamInput {
  name: string; leagueId: string; format: Format; managerIds: string[]; captainId: string;
}

@Injectable()
export class TeamService {
  private readonly recruitment = new NonexclusiveRecruitment();
  constructor(private readonly db: Database) {}

  async save(userId: string, input: TeamInput, teamId?: string) {
    const leagueId = objectId(input.leagueId);
    const ids = input.managerIds.map(objectId);
    const captainId = objectId(input.captainId);
    const budget = FORMATS[input.format];
    if (!budget || ids.length !== input.format || new Set(input.managerIds).size !== ids.length) {
      throw new BadRequestException('Select the exact format count with distinct managers');
    }
    if (!input.managerIds.includes(input.captainId)) throw new BadRequestException('Captain must belong to the team');
    try {
      const savedId = await this.db.transaction(async (session) => {
        const now = new Date();
        if (!await this.db.gameweeks.exists({}).session(session)) {
          throw new ConflictException('Official gameweeks must be synchronized first');
        }
        if (await this.db.gameweeks.exists({ deadline: { $lte: now }, finished: false }).session(session)) {
          throw new ConflictException('Teams are locked between the official deadline and gameweek completion');
        }
        if (!await this.db.leagues.exists({ _id: leagueId, active: true }).session(session)) {
          throw new NotFoundException('League not found or import is incomplete');
        }
        const managers = await this.db.managers.find({ _id: { $in: ids }, leagueId, active: true }).session(session);
        if (managers.length !== ids.length) throw new BadRequestException('Managers must belong to the selected league');
        if (managers.some((manager) => !this.recruitment.canRecruit())) throw new ConflictException('Recruitment unavailable');
        const spent = managers.reduce((sum, manager) => sum + manager.price, 0);
        if (spent > budget) throw new BadRequestException('Budget exceeded');
        const existing = teamId ? await this.db.teams.findOne({
          _id: objectId(teamId), userId: objectId(userId),
        }).session(session) : null;
        if (teamId && !existing) throw new NotFoundException('Team not found');
        if (existing && existing.leagueId.toString() !== input.leagueId) {
          throw new BadRequestException('A team cannot change league');
        }
        const data = {
          userId: objectId(userId), leagueId, name: input.name.trim(), format: input.format,
          managerIds: ids, captainId, budget, spent,
        };
        const team = existing
          ? await this.db.teams.findOneAndUpdate({ _id: existing._id }, { $set: data }, { new: true, session })
          : (await this.db.teams.create([data], { session }))[0];
        if (!team) throw new NotFoundException('Team not found');
        await this.db.members.deleteMany({ teamId: team._id }).session(session);
        await this.db.members.insertMany(ids.map((managerId) => ({
          teamId: team._id, managerId, captain: managerId.equals(captainId),
        })), { session });
        await this.captureTeam(team, session, now);
        // The write conflicts with bootstrap/snapshot processing, serializing relevant transactions.
        const future = await this.db.gameweeks.find({ deadline: { $gt: now }, finished: false }).session(session);
        if (!future.length) throw new ConflictException('No upcoming official gameweek');
        const nearestDeadline = Math.min(...future.map((gw) => gw.deadline.getTime()));
        if (Date.now() >= nearestDeadline) throw new ConflictException('Official deadline reached');
        await this.db.gameweeks.updateMany({ _id: { $in: future.map((gw) => gw._id) } },
          { $set: { snapshotsCaptured: true } }, { session });
        return team._id.toString();
      });
      return this.get(savedId);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('One team per user and league is allowed');
      throw error;
    }
  }

  async captureTeam(team: Team, session: ClientSession, now = new Date()) {
    const user = await this.db.users.findById(team.userId).session(session);
    if (!user || user.disabled) return;
    const gameweeks = await this.db.gameweeks.find({ deadline: { $gt: now }, finished: false }).session(session);
    for (const gw of gameweeks) {
      if (Date.now() >= gw.deadline.getTime()) throw new ConflictException('Deadline reached during snapshot capture');
      await this.db.scores.updateOne({ teamId: team._id, gw: gw.id, scored: false }, {
        $set: {
          leagueId: team.leagueId, userId: team.userId, teamName: team.name, pseudo: user.pseudo,
          managerIds: team.managerIds, captainId: team.captainId, capturedAt: now,
        }, $setOnInsert: { points: 0, scored: false },
      }, { upsert: true, session });
    }
    if (gameweeks.some((gw) => Date.now() >= gw.deadline.getTime())) {
      throw new ConflictException('Deadline reached during snapshot capture');
    }
  }

  async get(id: string) {
    const team = await this.db.teams.findById(objectId(id)).lean();
    if (!team) throw new NotFoundException('Team not found');
    const managers = await this.db.managers.find({ _id: { $in: team.managerIds } }).lean();
    const memberMap = new Map(managers.map((m) => [m._id.toString(), managerView(m)]));
    return {
      id: team._id.toString(), name: team.name, leagueId: team.leagueId.toString(),
      format: team.format, managerIds: team.managerIds.map(String), captainId: team.captainId.toString(),
      budget: team.budget, spent: team.spent, points: team.points, rank: team.rank,
      members: team.managerIds.map((id) => memberMap.get(id.toString())),
    };
  }

  async mine(userId: string) {
    const teams = await this.db.teams.find({ userId: objectId(userId) }).sort({ createdAt: 1 });
    return Promise.all(teams.map((team) => this.get(team._id.toString())));
  }

  async history(id: string) {
    const teamId = objectId(id);
    return this.db.transaction(async (session) => {
      const team = await this.db.teams.findById(teamId).session(session).lean();
      if (!team) throw new NotFoundException('Team not found');
      const scores = await this.db.scores.find({ leagueId: team.leagueId, scored: true })
        .sort({ gw: 1, teamId: 1 }).session(session).lean();
      const prices = await this.db.prices.find({ leagueId: team.leagueId })
        .sort({ gw: 1 }).session(session).lean();
      let overallPoints = 0;
      return scores.filter((score) => score.teamId.equals(teamId)).map((score) => {
        overallPoints += score.points;
        const totals = new Map<string, number>();
        for (const other of scores.filter((other) => other.gw <= score.gw)) {
          const key = other.teamId.toString();
          totals.set(key, (totals.get(key) ?? 0) + other.points);
        }
        const rank = 1 + [...totals.values()].filter((points) => points > overallPoints).length;
        const historicalPrices = new Map(prices.filter((price) => price.gw <= score.gw)
          .map((price) => [price.managerId.toString(), price.price]));
        const teamValue = score.teamValue ?? score.managerIds.reduce((sum, managerId) => {
          const price = historicalPrices.get(managerId.toString());
          if (price === undefined) throw new ConflictException(`Historical price unavailable for GW ${score.gw}`);
          return sum + price;
        }, 0);
        return {
          gw: score.gw, points: score.points, overallPoints: score.overallPoints ?? overallPoints,
          rank: score.rank ?? rank, teamValue: score.teamValue ?? teamValue,
        };
      });
    });
  }
}

export function managerView(manager: {
  _id: Types.ObjectId; fplId: number; name: string; rank: number;
  gwPoints: number; form: number; price: number;
}) {
  return {
    id: manager._id.toString(), fplId: manager.fplId, name: manager.name, rank: manager.rank,
    gwPoints: manager.gwPoints, form: manager.form, price: manager.price,
  };
}
