import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { budgetWithAppreciation, initialPrice, teamPoints } from '../domain/rules';
import { Database, User, UserTeam } from '../infrastructure/database';
import { FplClient } from '../infrastructure/fpl';

export interface TeamInput {
  name: string;
  leagueFplId: number;
  managerIds: number[];
  captainId: number;
}

const firstSeasonScoreGameweek = 7;

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

  async leagueTeam(leagueFplId: number, ownerFplId: number) {
    const user = await this.db.users.findOne({
      fplId: ownerFplId, 'team.leagueFplId': leagueFplId, disabled: false,
    }).lean();
    if (!user?.team) throw new NotFoundException('Fantasy team not found in this league');
    const events = await this.fpl.bootstrap();
    const current = events.find((event) => event.is_current && !event.finished);
    const managerScores = current
      ? await Promise.all(user.team.managers.map(async (manager) => [
        manager.fplId, await this.fpl.managerScore(manager.fplId),
      ] as const))
      : [];
    const scoresByManager = new Map(managerScores);
    return {
      ownerFplId: user.fplId,
      ownerName: `${user.firstName} ${user.lastName}`.trim(),
      teamName: user.team.name,
      captainId: user.team.captainId,
      managers: user.team.managers.map((manager) => {
        const score = scoresByManager.get(manager.fplId);
        return {
          ...manager,
          currentGameweekPoints: current && score?.currentGameweek === current.id
            ? score.currentGameweekPoints
            : null,
        };
      }),
    };
  }

  async standings(leagueFplId: number) {
    const users = await this.db.users.find({ 'team.leagueFplId': leagueFplId, disabled: false }).lean();
    const events = await this.fpl.bootstrap();
    const current = events.find((event) => event.is_current && !event.finished);
    const latestCompleted = current ? undefined : events
      .filter((event) => event.finished && event.data_checked)
      .sort((a, b) => b.id - a.id)[0];
    const gw = current?.id ?? latestCompleted?.id ?? null;
    const managerIds = current
      ? [...new Set(users.flatMap((user) => {
        const snapshots = user.team?.pendingSnapshots ?? [];
        return snapshots.find((snapshot) => snapshot.gw === current.id)?.managerIds
          ?? user.team?.managerIds ?? [];
      }))]
      : [];
    const liveScores = await Promise.all(managerIds.map(async (id) =>
      [id, await this.fpl.managerScore(id)] as const));
    const scoresByManager = new Map(liveScores);
    const rows = users.map((user) => {
      const team = user.team!;
      let seasonScore = (user.scoreHistory ?? [])
        .filter((score) => score.gw >= firstSeasonScoreGameweek)
        .reduce((total, score) => total + score.points, 0);
      const currentSnapshot = current
        ? team.pendingSnapshots?.find((snapshot) => snapshot.gw === current.id)
        : undefined;
      const activeManagerIds = currentSnapshot?.managerIds ?? team.managerIds;
      const livePoints = new Map<number, number>();
      if (current) {
        for (const id of activeManagerIds) {
          const managerScore = scoresByManager.get(id);
          if (managerScore?.currentGameweek === current.id) {
            livePoints.set(id, managerScore.currentGameweekPoints);
          }
        }
      }
      const completedScore = latestCompleted
        ? user.scoreHistory?.find((score) => score.gw === latestCompleted.id)
        : undefined;
      const currentScore = current && activeManagerIds.every((id) => livePoints.has(id))
        ? scoreManagers(activeManagerIds, currentSnapshot?.captainId ?? team.captainId, livePoints)
        : null;
      if (current && current.id >= firstSeasonScoreGameweek && currentScore !== null) {
        seasonScore += currentScore;
      }
      const gwScore = currentScore ?? completedScore?.points ?? 0;
      return {
        ownerFplId: user.fplId,
        ownerName: `${user.firstName} ${user.lastName}`.trim(),
        teamName: team.name,
        gwScore,
        seasonScore,
        gw,
      };
    });
    rows.sort((a, b) => b.seasonScore - a.seasonScore || a.ownerFplId - b.ownerFplId);
    return rows.map((row, index) => ({
      rank: index + 1,
      ...row,
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
    const previousManagers = new Map((existingUser.team?.managers ?? [])
      .map((manager) => [manager.fplId, manager] as const));
    const ownedManagers = [...previousManagers.values()].map((manager) => {
      const current = standings.managers.find((candidate) => candidate.entry === manager.fplId);
      return {
        fplId: manager.fplId, price: current ? initialPrice(current.rank, count) : manager.price,
        purchasePrice: manager.purchasePrice ?? manager.price,
      };
    });
    const previousCapital = existingUser.team?.transferCapital ?? 250;
    const budget = budgetWithAppreciation(ownedManagers, previousCapital);
    const transferCapital = previousCapital + ownedManagers
      .filter((manager) => !input.managerIds.includes(manager.fplId))
      .reduce((total, manager) => total + manager.price - manager.purchasePrice, 0);
    const roster = managers.map((manager) => {
      const price = initialPrice(manager!.rank, count);
      const previous = previousManagers.get(manager!.entry);
      return {
        fplId: manager!.entry, name: manager!.player_name, rank: manager!.rank, price,
        purchasePrice: previous?.purchasePrice ?? previous?.price ?? price,
      };
    });
    const spent = roster.reduce((sum, manager) => sum + manager.price, 0);
    if (spent > budget) throw new BadRequestException('The five managers exceed the available transfer budget');
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
      budget, spent, transferCapital, managers: roster,
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

  async view(user: User, includeLiveManagerScores = false) {
    const events = await this.fpl.bootstrap();
    const current = events.find((event) => event.is_current && !event.finished);
    const team = user.team;
    let managers = team?.managers ?? [];
    let budget = team?.budget ?? 250;
    let spent = team?.spent ?? 0;
    if (team?.leagueFplId && managers.length) {
      const standings = await this.fpl.standings(team.leagueFplId);
      const count = standings.managers.length;
      managers = managers.map((manager) => {
        const currentManager = standings.managers.find((candidate) => candidate.entry === manager.fplId);
        const purchasePrice = manager.purchasePrice ?? manager.price;
        return {
          fplId: manager.fplId, name: currentManager?.player_name ?? manager.name,
          rank: currentManager?.rank ?? manager.rank,
          price: currentManager ? initialPrice(currentManager.rank, count) : manager.price,
          purchasePrice,
        };
      });
      spent = managers.reduce((total, manager) => total + manager.price, 0);
      budget = budgetWithAppreciation(managers, team.transferCapital ?? 250);
    }
    const managerScores = includeLiveManagerScores && team
      ? await Promise.all(managers.map(async (manager) => [
        manager.fplId, await this.fpl.managerScore(manager.fplId),
      ] as const))
      : [];
    const scoresByManager = new Map(managerScores);
    let currentScore: number | null = null;
    if (includeLiveManagerScores && current && team) {
      const snapshot = team.pendingSnapshots?.find((item) => item.gw === current.id);
      const managerIds = snapshot?.managerIds ?? team.managerIds;
      const captainId = snapshot?.captainId ?? team.captainId;
      await Promise.all(managerIds.filter((id) => !scoresByManager.has(id)).map(async (id) => {
        scoresByManager.set(id, await this.fpl.managerScore(id));
      }));
      const points = new Map([...scoresByManager]
        .filter(([, score]) => score.currentGameweek === current.id)
        .map(([id, score]) => [id, score.currentGameweekPoints]));
      if (managerIds.every((id) => points.has(id))) {
        currentScore = scoreManagers(managerIds, captainId, points);
      }
    }
    const completedSeasonScore = (user.scoreHistory ?? [])
      .filter((score) => score.gw >= firstSeasonScoreGameweek)
      .reduce((total, score) => total + score.points, 0);
    return {
      id: user.fplId, fplId: user.fplId, name: user.team?.name ?? '',
      leagueFplId: user.team?.leagueFplId ?? null, leagueName: user.team?.leagueName ?? '',
      firstScoringGw: user.team?.firstScoringGw ?? null,
      format: 5, managerIds: user.team?.managerIds ?? [], captainId: user.team?.captainId ?? null,
      currentDeadline: current?.deadline_time ?? null,
      budget, spent, transferCapital: team?.transferCapital ?? 250,
      members: managers.map((manager) => {
        const score = scoresByManager.get(manager.fplId);
        return {
          id: manager.fplId, fplId: manager.fplId, name: manager.name, rank: manager.rank,
          price: manager.price, purchasePrice: manager.purchasePrice, totalPoints: score?.totalPoints ?? 0,
          lastGwPoints: score?.currentGameweekPoints ?? 0, gwPoints: score?.currentGameweekPoints ?? 0,
          form: score?.currentGameweekPoints ?? 0, currentGameweek: score?.currentGameweek ?? null,
          currentGameweekPoints: score?.currentGameweekPoints ?? 0,
        };
      }), scores: user.scoreHistory ?? [], totalScore: user.totalScore ?? 0,
      seasonScore: completedSeasonScore
        + (current && current.id >= firstSeasonScoreGameweek ? currentScore ?? 0 : 0),
      editsLocked: gameweekEditsLocked(events),
    };
  }
}

export function scoreManagers(managerIds: number[], captainId: number, points: Map<number, number>) {
  return teamPoints(managerIds.map(String), String(captainId), new Map(
    [...points.entries()].map(([id, value]) => [String(id), value]),
  ));
}
