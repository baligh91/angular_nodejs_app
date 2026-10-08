import {
  CanActivate, ConflictException, ExecutionContext, ForbiddenException,
  Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { Database, User } from '../infrastructure/database';
import { Config } from '../infrastructure/config';
import { FplClient } from '../infrastructure/fpl';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const Public = () => SetMetadata('public', true);

export function userView(user: User) {
  return {
    id: user._id.toString(), fplId: user.fplId, firstName: user.firstName,
    lastName: user.lastName, fplTeamName: user.fplTeamName, fplLeagues: user.fplLeagues, team: user.team,
    scoreHistory: user.scoreHistory, totalScore: user.totalScore,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database, private readonly config: Config,
    private readonly jwt: JwtService, private readonly fpl: FplClient,
  ) {}

  async login(fplId: number) {
    const profile = await this.fpl.entry(fplId);
    const token = randomBytes(48).toString('base64url');
    const existing = await this.db.users.findOne({ fplId });
    if (existing?.disabled) throw new ForbiddenException('Account disabled');
    let user: User | null;
    try {
      user = await this.db.users.findOneAndUpdate({ fplId, disabled: false }, {
        $set: { firstName: profile.firstName, lastName: profile.lastName,
          fplTeamName: profile.teamName, fplLeagues: profile.leagues, refreshHash: digest(token),
          refreshExpires: new Date(Date.now() + 7 * 86400000) },
        $setOnInsert: { scoreHistory: [], totalScore: 0 },
        $inc: { tokenVersion: 1 },
      }, { new: true, upsert: true, setDefaultsOnInsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      user = await this.db.users.findOne({ fplId });
      if (user?.disabled) throw new ForbiddenException('Account disabled');
      throw new ConflictException('FPL identity logged in concurrently; retry login');
    }
    if (!user) throw new ForbiddenException('Account disabled');
    return { body: { accessToken: this.access(user), user: userView(user) }, refreshToken: `${user._id}.${token}` };
  }

  private access(user: User) {
    return this.jwt.sign({ sub: user._id.toString(), ver: user.tokenVersion }, {
      secret: this.config.jwtSecret, expiresIn: '15m', issuer: 'fml', audience: 'fml-web',
    });
  }

  async refresh(cookie?: string) {
    const [id, token, extra] = (cookie || '').split('.');
    if (!Types.ObjectId.isValid(id || '') || !token || extra) throw new UnauthorizedException('Invalid refresh token');
    const rotated = randomBytes(48).toString('base64url');
    const user = await this.db.users.findOneAndUpdate({
      _id: id, fplId: { $type: 'number', $gt: 0 }, refreshHash: digest(token),
      refreshExpires: { $gt: new Date() }, disabled: false,
    }, { $set: { refreshHash: digest(rotated), refreshExpires: new Date(Date.now() + 7 * 86400000) } },
    { new: true });
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return {
      body: { accessToken: this.access(user), user: userView(user) },
      refreshToken: `${user._id}.${rotated}`,
    };
  }

  async logout(cookie?: string) {
    const [id, token] = (cookie || '').split('.');
    if (Types.ObjectId.isValid(id || '') && token) {
      await this.db.users.updateOne({ _id: id, refreshHash: digest(token) }, {
        $unset: { refreshHash: 1, refreshExpires: 1 }, $inc: { tokenVersion: 1 },
      });
    }
    return { message: 'Logged out' };
  }

}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector, private readonly jwt: JwtService,
    private readonly db: Database, private readonly config: Config,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride('public', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest();
    const match = /^Bearer (.+)$/.exec(request.headers.authorization || '');
    if (!match) throw new UnauthorizedException();
    try {
      const payload = this.jwt.verify<{ sub: string; ver: number }>(match[1], {
        secret: this.config.jwtSecret, issuer: 'fml', audience: 'fml-web', algorithms: ['HS256'],
      });
      if (!Types.ObjectId.isValid(payload.sub)) throw new Error();
      const user = await this.db.users.findOne({ _id: payload.sub, disabled: false });
      if (!user || !Number.isSafeInteger(user.fplId) || !user.fplId || user.fplId < 1
        || user.tokenVersion !== payload.ver) throw new Error();
      request.user = user;
    } catch { throw new UnauthorizedException(); }
    return true;
  }
}
