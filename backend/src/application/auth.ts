import {
  CanActivate, ConflictException, ExecutionContext, ForbiddenException,
  Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { Database, User } from '../infrastructure/database';
import { Config } from '../infrastructure/config';
import { FplClient, FplProfile } from '../infrastructure/fpl';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const Public = () => SetMetadata('public', true);
export const Admin = () => SetMetadata('admin', true);

export function userView(user: User) {
  return {
    id: user._id.toString(), fplId: user.fplId, pseudo: user.pseudo, role: user.role,
    avatar: user.avatar, favoriteTeam: user.favoriteTeam, fplProfile: user.fplProfile,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database, private readonly config: Config,
    private readonly jwt: JwtService, private readonly fpl: FplClient,
  ) {}

  private profileData(profile: FplProfile) {
    return {
      fplProfile: profile, pseudo: `${profile.firstName} ${profile.lastName}`.trim() || `FPL ${profile.id}`,
      favoriteTeam: profile.favoriteTeam?.name ?? null,
    };
  }

  async challenge(fplId: number) {
    const profile = await this.fpl.entry(fplId);
    const challengeId = randomBytes(32).toString('base64url');
    const code = `FML-${randomBytes(8).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 15 * 60000);
    await this.db.challenges.create({ fplId, challengeHash: digest(challengeId), codeHash: digest(code), expiresAt });
    return { challengeId, code, expiresAt, profile };
  }

  async verifyChallenge(challengeId: string) {
    const challenge = await this.db.challenges.findOneAndUpdate({
      challengeHash: digest(challengeId), consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() }, attempts: { $lt: 10 },
    }, { $inc: { attempts: 1 } }, { new: true });
    if (!challenge) throw new UnauthorizedException('Invalid, expired or exhausted FPL challenge');
    const profile = await this.fpl.entry(challenge.fplId);
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const code = profile.teamName.trim();
    const matched = /^FML-[A-F0-9]{16}$/.test(code)
      && timingSafeEqual(Buffer.from(digest(code), 'hex'), expected);
    if (!matched) throw new UnauthorizedException('Set your FPL team name to the exact verification code');
    const token = randomBytes(48).toString('base64url');
    const role = this.config.adminFplIds.includes(challenge.fplId) ? 'admin' : 'user';
    return this.db.transaction(async (session) => {
      const consumed = await this.db.challenges.findOneAndUpdate({
        _id: challenge._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() },
        attempts: { $lte: 10 },
      }, { $set: { consumedAt: new Date() } }, { new: true, session });
      if (!consumed) throw new UnauthorizedException('FPL challenge already consumed or expired');
      let user = await this.db.users.findOne({ fplId: challenge.fplId }).session(session);
      if (user?.disabled) throw new ForbiddenException('Account disabled');
      if (!user) user = (await this.db.users.create([{
        fplId: challenge.fplId, ...this.profileData(profile), role,
      }], { session }))[0];
      user = (await this.db.users.findOneAndUpdate({ _id: user._id, disabled: false }, {
        $set: { ...this.profileData(profile), role, refreshHash: digest(token),
          refreshExpires: new Date(Date.now() + 7 * 86400000) },
        $inc: { tokenVersion: 1 },
      }, { new: true, session }))!;
      if (!user) throw new ForbiddenException('Account disabled');
      return { body: { accessToken: this.access(user), user: userView(user) }, refreshToken: `${user._id}.${token}` };
    }).catch((error) => {
      if (error.code === 11000) throw new ConflictException('FPL identity connected concurrently; retry verification');
      throw error;
    });
  }

  async syncProfile(user: User) {
    if (!user.fplId) throw new UnauthorizedException('FPL connection required');
    const profile = await this.fpl.entry(user.fplId);
    const updated = await this.db.users.findOneAndUpdate({ _id: user._id, fplId: user.fplId, disabled: false },
      { $set: this.profileData(profile) }, { new: true });
    if (!updated) throw new UnauthorizedException();
    return userView(updated);
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
      _id: id, fplId: { $type: 'number', $gt: 0 }, 'fplProfile.id': { $exists: true },
      $expr: { $eq: ['$fplId', '$fplProfile.id'] }, refreshHash: digest(token),
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
        || user.fplProfile?.id !== user.fplId
        || user.tokenVersion !== payload.ver) throw new Error();
      request.user = user;
    } catch { throw new UnauthorizedException(); }
    if (this.reflector.getAllAndOverride('admin', [context.getHandler(), context.getClass()])
      && (request.user.role !== 'admin' || !this.config.adminFplIds.includes(request.user.fplId))) {
      throw new ForbiddenException('Administrator role required');
    }
    return true;
  }
}
