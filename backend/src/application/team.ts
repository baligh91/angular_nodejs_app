import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { initialPrice, teamPoints } from '../domain/rules';
import { Database, User, UserTeam } from '../infrastructure/database';
import { FplClient } from '../infrastructure/fpl';

export interface TeamInput {
  name: string;
  leagueFplId: number;
  managerIds: number[];
  captainId: number;
}

export function firstScoringGameweek(events: Awaited<ReturnType<FplClient['bootstrap']>>): number {
  const current = events.find((event) => event.is_current);
  if (current) return current.id + 1;
  const upcoming = events.filter((event) => !event.finished).map((event) => event.id);
  return upcoming.length ? Math.min(...upcoming) : Math.max(0, ...events.map((event) => event.id)) + 1;
}

function gameweekEditsLocked(events: Awaited<ReturnType<FplClient['bootstrap']>>, now = Date.now()): boolean {
  const current = events.find((event) => event.is_current && !event.finished);
  return !!current && now >= Date.parse(current.deadline_time);
}

@Injectable()
export class TeamService {
  constructor(private readonly db: Database, private readonly fpl: FplClient) {}

  async myLeagues(userId: string) {
    const user = await this.db.users.findOne({ _id: new Types.ObjectId(userId), disabled: false });
    if (!user) throw new NotFoundException('FPL user not found');
    const profile = await this.fpl.entry(user.fplId);
    const updated = await this.db.users.findOneAndUpdate(
      { _id: user._id, disabled: false }, { $set: { fplLeagues: profile.leagues } }, { new: true },
    );
    if (!updated) throw new NotFoundException('FPL user not found');
    return updated.fplLeagues;
  }

  async managers(leagueFplId: number) {
    const standings = await this.fpl.standings(leagueFplId);
    const count = standings.managers.length;
    return {
      leagueFplId,
      leagueName: standings.name,
      managers: standings.managers.map((manager) => ({
        id: manager.entry, fplId: manager.entry, name: manager.player_name,
        rank: manager.rank, totalPoints: manager.total,
        lastGwPoints: manager.event_total, gwPoints: manager.event_total, form: manager.event_total,
        price: initialPrice(manager.rank, count),
      })),
    };
  }

  async standings(leagueFplId: number) {
    const users = await this.db.users.find({ 'team.leagueFplId': leagueFplId, disabled: false })
      .sort({ totalScore: -1, fplId: 1 }).lean();
    return users.map((user, index) => ({
      rank: index + 1,
      ownerFplId: user.fplId,
      ownerName: `${user.firstName} ${user.lastName}`.trim(),
      teamName: user.team?.name ?? '',
      points: user.totalScore ?? 0,
    }));
  }

  async save(userId: string, input: TeamInput) {
    if (!Number.isSafeInteger(input.leagueFplId) || input.leagueFplId < 1) {
      throw new BadRequestException('Enter a valid public FPL classic league ID');
    }
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 60) {
      throw new BadRequestException('Team name must contain 2–60 characters');
    }
    if (!Array.isArray(input.managerIds) || input.managerIds.length !== 5
      || new Set(input.managerIds).size !== 5
      || input.managerIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      throw new BadRequestException('Select exactly five distinct managers');
    }
    if (!input.managerIds.includes(input.captainId)) {
      throw new BadRequestException('Captain must belong to the team');
    }
    const userIdObject = new Types.ObjectId(userId);
    const existingUser = await this.db.users.findOne({ _id: userIdObject, disabled: false });
    if (!existingUser) throw new NotFoundException('FPL user not found');
    if (existingUser.team?.leagueFplId && existingUser.team.leagueFplId !== input.leagueFplId) {
      throw new BadRequestException('An existing team cannot change its FPL league');
    }
    const events = await this.fpl.bootstrap();
    if (gameweekEditsLocked(events)) {
      throw new ConflictException('Team changes are locked until the current gameweek finishes');
    }
    const standings = await this.fpl.standings(input.leagueFplId);
    const managers = input.managerIds.map((id) => standings.managers.find((manager) => manager.entry === id));
    if (managers.some((manager) => !manager)) {
      throw new BadRequestException('All selected managers must belong to the chosen FPL league');
    }
    const count = standings.managers.length;
    const roster = managers.map((manager) => ({
      fplId: manager!.entry, name: manager!.player_name, rank: manager!.rank,
      price: initialPrice(manager!.rank, count),
    }));
    const budget = 250;
    const spent = roster.reduce((sum, manager) => sum + manager.price, 0);
    if (spent > budget) throw new BadRequestException('The five managers exceed the 25M budget');
    if (gameweekEditsLocked(events)) {
      throw new ConflictException('Team changes are locked until the current gameweek finishes');
    }
    const storedGameweeks = [
      ...(existingUser.scoreHistory ?? []).map((score) => score.gw),
      ...(existingUser.team?.pendingSnapshots ?? []).map((snapshot) => snapshot.gw),
    ];
    const firstScoringGw = existingUser.team?.firstScoringGw
      ?? (storedGameweeks.length ? Math.min(...storedGameweeks) : firstScoringGameweek(events));
    const team: UserTeam = {
      name: input.name.trim(), leagueFplId: input.leagueFplId, leagueName: standings.name,
      format: 5, firstScoringGw, managerIds: input.managerIds, captainId: input.captainId,
      budget, spent, managers: roster,
      pendingSnapshots: events.filter((event) => event.id >= firstScoringGw
        && !event.finished && Date.now() < Date.parse(event.deadline_time))
        .map((event) => ({
          gw: event.id, managerIds: [...input.managerIds], captainId: input.captainId,
          teamName: input.name.trim(), capturedAt: new Date(),
        })),
    };
    const updated = await this.db.users.findOneAndUpdate(
      { _id: userIdObject, disabled: false }, { $set: { team } }, { new: true },
    );
    if (!updated) throw new NotFoundException('FPL user not found');
    return this.view(updated);
  }

  async mine(userId: string) {
    const user = await this.db.users.findOne({ _id: new Types.ObjectId(userId), disabled: false });
    if (!user) throw new NotFoundException('FPL user not found');
    return this.view(user);
  }

  async view(user: User) {
    const events = await this.fpl.bootstrap();
    const current = events.find((event) => event.is_current && !event.finished);
    return {
      id: user.fplId, fplId: user.fplId, name: user.team?.name ?? '',
      leagueFplId: user.team?.leagueFplId ?? null, leagueName: user.team?.leagueName ?? '',
      firstScoringGw: user.team?.firstScoringGw ?? null,
      format: 5, managerIds: user.team?.managerIds ?? [], captainId: user.team?.captainId ?? null,
      currentDeadline: current?.deadline_time ?? null,
      budget: user.team?.budget ?? 250, spent: user.team?.spent ?? 0,
      members: user.team?.managers ?? [], scores: user.scoreHistory ?? [], totalScore: user.totalScore ?? 0,
      editsLocked: gameweekEditsLocked(events),
    };
  }
}

export function scoreManagers(managerIds: number[], captainId: number, points: Map<number, number>) {
  return teamPoints(managerIds.map(String), String(captainId), new Map(
    [...points.entries()].map(([id, value]) => [String(id), value]),
  ));
}
