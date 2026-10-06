import {
  Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseIntPipe,
  Patch, Post, Put, Query, Req, Res, ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Admin, AuthService, Public, userView } from '../application/auth';
import { TeamService, managerView, objectId } from '../application/teams';
import { SyncService } from '../application/sync';
import { Database, User } from '../infrastructure/database';
import { Config } from '../infrastructure/config';
import {
  DisableDto, EmptyDto, FplChallengeDto, FplVerifyDto, LeagueDto, LeagueQueryDto, LeagueStatusDto,
  ProfileDto, RankingQueryDto, TeamDto,
} from './dto';

type AuthRequest = Request & { user: User };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: Database, private readonly config: Config) {}
  private origin(req: Request) {
    const origin = req.headers.origin;
    if ((origin && origin !== this.config.origin)
      || (!origin && req.headers['sec-fetch-site'] === 'cross-site')) {
      throw new ForbiddenException('Untrusted request origin');
    }
  }
  private cookie(res: Response, value: string) {
    res.cookie('fml_refresh', value, {
      httpOnly: true, secure: this.config.cookieSecure, sameSite: 'lax',
      path: '/api/auth', maxAge: 7 * 86400000,
    });
    res.setHeader('Cache-Control', 'no-store');
  }
  @Public() @Post('fpl/challenge') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async challenge(@Body() body: FplChallengeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.challenge(body.fplId);
  }
  @Public() @Post('fpl/verify') @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async verify(@Body() body: FplVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(req);
    const result = await this.auth.verifyChallenge(body.challengeId);
    this.cookie(res, result.refreshToken);
    return result.body;
  }
  @Public() @ApiCookieAuth('fml_refresh') @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(req);
    const result = await this.auth.refresh(req.cookies?.fml_refresh);
    this.cookie(res, result.refreshToken);
    return result.body;
  }
  @Public() @ApiCookieAuth('fml_refresh') @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(req);
    const result = await this.auth.logout(req.cookies?.fml_refresh);
    res.clearCookie('fml_refresh', { path: '/api/auth', httpOnly: true,
      secure: this.config.cookieSecure, sameSite: 'lax' });
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }
  @ApiBearerAuth() @Get('me')
  me(@Req() req: AuthRequest) { return userView(req.user); }
  @ApiBearerAuth() @Patch('me')
  async profile(@Req() req: AuthRequest, @Body() body: ProfileDto) {
    const user = await this.db.users.findByIdAndUpdate(req.user._id, { $set: body }, { new: true });
    return userView(user!);
  }
  @ApiBearerAuth() @Post('fpl/sync') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  syncProfile(@Req() req: AuthRequest, @Body() _body: EmptyDto) { return this.auth.syncProfile(req.user); }
}

@ApiTags('leagues') @ApiBearerAuth() @Controller('leagues')
export class LeagueController {
  constructor(private readonly db: Database, private readonly sync: SyncService) {}
  @Get()
  async list() {
    return (await this.db.leagues.find({ active: true }).sort({ name: 1 }).lean())
      .map((league) => ({ id: league._id.toString(), fplId: league.fplId, name: league.name }));
  }
  @Post()
  @ApiOperation({ summary: 'Import an FPL classic league for an authenticated user' })
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  import(@Body() body: LeagueDto) { return this.sync.importLeague(body.fplId); }
  @Get(':id')
  async get(@Param('id') id: string) {
    const league = await this.db.leagues.findOne({ _id: objectId(id), active: true });
    if (!league) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('League not found');
    }
    return { id: league._id.toString(), fplId: league.fplId, name: league.name };
  }
}

@ApiTags('managers') @ApiBearerAuth() @Controller('managers')
export class ManagerController {
  constructor(private readonly db: Database) {}
  @Get()
  async list(@Query() query: LeagueQueryDto) {
    const leagueId = objectId(query.leagueId);
    const managers = await this.db.managers.find({ leagueId, active: true }).sort({ rank: 1, fplId: 1 }).lean();
    const prices = await this.db.prices.find({ leagueId }).sort({ gw: 1 }).lean();
    return managers.map((manager) => ({
      ...managerView(manager),
      priceHistory: prices.filter((price) => price.managerId.equals(manager._id))
        .map((price) => ({ gw: price.gw, price: price.price, delta: price.delta })),
    }));
  }
}

@ApiTags('teams') @ApiBearerAuth() @Controller('teams')
export class TeamController {
  constructor(private readonly teams: TeamService) {}
  @Get('mine')
  mine(@Req() req: AuthRequest) { return this.teams.mine(req.user._id.toString()); }
  @Post()
  create(@Req() req: AuthRequest, @Body() body: TeamDto) {
    return this.teams.save(req.user._id.toString(), body);
  }
  @Put(':id')
  update(@Req() req: AuthRequest, @Body() body: TeamDto, @Param('id') id: string) {
    return this.teams.save(req.user._id.toString(), body, id);
  }
  @Get(':id')
  get(@Param('id') id: string) { return this.teams.get(id); }
  @Get(':id/history')
  @ApiOperation({ summary: 'Settled GW scores, cumulative points, historical overall league rank and roster value' })
  history(@Param('id') id: string) { return this.teams.history(id); }
}

@ApiTags('rankings') @ApiBearerAuth() @Controller('rankings')
export class RankingController {
  constructor(private readonly sync: SyncService) {}
  @Get('gw/:gw')
  gw(@Param('gw', ParseIntPipe) gw: number, @Query() query: RankingQueryDto) {
    if (gw < 1 || gw > 100) {
      const { BadRequestException } = require('@nestjs/common');
      throw new BadRequestException('Invalid gameweek');
    }
    return this.sync.rankings(query.leagueId, gw);
  }
  @Get('overall')
  overall(@Query() query: RankingQueryDto) { return this.sync.rankings(query.leagueId); }
}

@ApiTags('gameweeks') @ApiBearerAuth() @Controller('gameweeks')
export class GameweekController {
  constructor(private readonly db: Database) {}
  @Get()
  async list() {
    return (await this.db.gameweeks.find().sort({ id: 1 }).lean())
      .map((gw) => ({ id: gw.id, deadline: gw.deadline, finished: gw.finished, current: gw.current }));
  }
}

@ApiTags('admin') @ApiBearerAuth() @Admin() @Controller('admin')
export class AdminController {
  constructor(private readonly db: Database, private readonly sync: SyncService) {}
  @Post('sync') @HttpCode(200)
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  synchronize() { return this.sync.sync(); }
  @Patch('leagues/:id')
  leagueStatus(@Param('id') id: string, @Body() body: LeagueStatusDto) {
    return this.sync.setLeagueActive(id, body.active);
  }
  @Get('users')
  async users() {
    return (await this.db.users.find({ fplId: { $exists: true } }).sort({ fplId: 1 }).lean())
      .map((user) => ({ ...userView(user), disabled: user.disabled }));
  }
  @Patch('users/:id')
  async disable(@Param('id') id: string, @Body() body: DisableDto, @Req() req: AuthRequest) {
    const userId = objectId(id);
    if (userId.equals(req.user._id) && body.disabled) throw new ForbiddenException('Cannot disable yourself');
    const user = await this.db.users.findByIdAndUpdate(userId, {
      $set: { disabled: body.disabled }, $inc: { tokenVersion: 1 },
      $unset: { refreshHash: 1, refreshExpires: 1 },
    }, { new: true });
    if (!user) {
      const { NotFoundException } = require('@nestjs/common');
      throw new NotFoundException('User not found');
    }
    return { ...userView(user), disabled: user.disabled };
  }
  @Get('leagues')
  async leagues() {
    return (await this.db.leagues.find().lean()).map((league) => ({
      id: league._id.toString(), fplId: league.fplId, name: league.name, active: league.active,
      importedAt: league.importedAt, lastSyncedAt: league.lastSyncedAt,
    }));
  }
  @Get('gameweeks')
  async gameweeks() {
    return (await this.db.gameweeks.find().sort({ id: 1 }).lean()).map((gw) => ({
      id: gw.id, deadline: gw.deadline, finished: gw.finished,
      current: gw.current, dataChecked: gw.dataChecked,
    }));
  }
}

@ApiTags('health') @Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}
  @Public() @Get()
  async health() {
    try { await this.db.connection.db!.admin().ping(); }
    catch { throw new ServiceUnavailableException('Database unavailable'); }
    return { status: 'ok' };
  }
}
