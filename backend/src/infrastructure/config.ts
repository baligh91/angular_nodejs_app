import { Injectable } from '@nestjs/common';

@Injectable()
export class Config {
  readonly production = process.env.NODE_ENV === 'production';
  readonly port = Number(process.env.PORT || 3000);
  readonly mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fml';
  readonly jwtSecret = process.env.JWT_SECRET || '';
  readonly origin = process.env.APP_ORIGIN || (
    process.env.VERCEL_ENV === 'production'
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:4200'
  );
  readonly cronSecret = process.env.CRON_SECRET || '';
  readonly cookieSecure = process.env.COOKIE_SECURE === 'true' || this.production;
  readonly syncEnabled = process.env.SYNC_ENABLED !== 'false';
  readonly fplBase = process.env.FPL_BASE_URL || 'https://fantasy.premierleague.com/api/';

  constructor() {
    if (this.jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('Invalid PORT');
    if (!/^mongodb(\+srv)?:\/\//.test(this.mongoUri)) throw new Error('Invalid MONGODB_URI');
    for (const value of [this.origin, this.fplBase]) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid application/FPL URL');
      if (this.production && url.protocol !== 'https:') throw new Error('Production URLs require HTTPS');
    }
  }
}
