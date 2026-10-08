import {
  Body, Controller, ForbiddenException, Get, HttpCode, Post, Put, Query, Req, Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public, AuthService, userView } from '../application/auth';
import { TeamService } from '../application/team';
import { ScoringService } from '../application/scoring';
import { Database, User } from '../infrastructure/database';
import { Config } from '../infrastructure/config';
import { FplLoginDto, ManagerLeagueQueryDto, TeamDto } from './single-dto';

type AuthRequest = Request & { user: User };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: Config) {}

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
  @Public() @Post('fpl/login') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() body: FplLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(req);
    const result = await this.auth.login(body.fplId);
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
}

@ApiTags('team') @ApiBearerAuth() @Controller('team')
export class TeamController {
  constructor(
    private readonly teams: TeamService, private readonly scoring: ScoringService,
    private readonly db: Database,
  ) {}

  @Get('leagues')
  leagues(@Req() req: AuthRequest) { return this.teams.myLeagues(req.user._id.toString()); }

  @Get('managers')
  managers(@Query() query: ManagerLeagueQueryDto) { return this.teams.managers(query.leagueFplId); }

  @Get('standings')
  standings(@Query() query: ManagerLeagueQueryDto) { return this.teams.standings(query.leagueFplId); }

  @Get()
  get(@Req() req: AuthRequest) { return this.teams.mine(req.user._id.toString()); }

  @Put()
  save(@Req() req: AuthRequest, @Body() body: TeamDto) {
    return this.teams.save(req.user._id.toString(), body);
  }

  @Post('sync') @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sync(@Req() req: AuthRequest) {
    await this.scoring.syncUser(req.user);
    const user = await this.db.users.findById(req.user._id);
    if (!user) throw new ServiceUnavailableException('User record unavailable');
    return this.teams.view(user);
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
