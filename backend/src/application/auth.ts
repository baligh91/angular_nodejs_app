import {
  CanActivate, ConflictException, ExecutionContext,
  Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { Database, User } from '../infrastructure/database';
import { Config } from '../infrastructure/config';
import { FplClient } from '../infrastructure/fpl';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const derivePasswordKey = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key));
});
const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derivePasswordKey(password, salt)).toString('hex')}`;
};
const DUMMY_PASSWORD_HASH = hashPassword('invalid-login-placeholder');
const verifyPassword = async (password: string, encoded: string) => {
  const [algorithm, salt, hash, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || extra !== undefined
    || !/^[a-f\d]{32}$/i.test(salt) || !/^[a-f\d]{128}$/i.test(hash)) return false;
  const candidate = await derivePasswordKey(password, salt);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
};
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

  async register(fplId: number, password: string) {
    if (await this.db.users.exists({ fplId })) throw new ConflictException('FPL ID is already registered');
    const profile = await this.fpl.entry(fplId);
    let user: User;
    try {
      user = await this.db.users.create({
        fplId, firstName: profile.firstName, lastName: profile.lastName,
        fplTeamName: profile.teamName, fplLeagues: profile.leagues,
        passwordHash: await hashPassword(password), scoreHistory: [], totalScore: 0,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      throw new ConflictException('FPL ID is already registered');
    }
    return this.issueSession(user);
  }

  async login(fplId: number, password: string) {
    const user = await this.db.users.findOne({ fplId }).select('+passwordHash');
    const passwordHash = user?.passwordHash || await DUMMY_PASSWORD_HASH;
    const validPassword = await verifyPassword(password, passwordHash);
    if (!user || user.disabled || !validPassword) {
      throw new UnauthorizedException('Invalid FPL ID or password');
    }
    return this.issueSession(user);
  }

  private async issueSession(user: User) {
    const token = randomBytes(48).toString('base64url');
    const authenticatedUser = await this.db.users.findOneAndUpdate({ _id: user._id, disabled: false }, {
      $set: { refreshHash: digest(token), refreshExpires: new Date(Date.now() + 7 * 86400000) },
      $inc: { tokenVersion: 1 },
    }, { new: true });
    if (!authenticatedUser) throw new UnauthorizedException('Invalid FPL ID or password');
    return {
      body: { accessToken: this.access(authenticatedUser), user: userView(authenticatedUser) },
      refreshToken: `${authenticatedUser._id}.${token}`,
    };
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
