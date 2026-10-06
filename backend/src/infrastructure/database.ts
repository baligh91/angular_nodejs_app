import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import mongoose, { Connection, Model, Schema, Types, ClientSession } from 'mongoose';
import { Config } from './config';
import { FplClient, FplProfile } from './fpl';

export interface User {
  _id: Types.ObjectId; fplId?: number; pseudo: string; fplProfile?: FplProfile;
  role: 'user' | 'admin'; disabled: boolean; avatar?: string | null; favoriteTeam?: string | null;
  tokenVersion: number; refreshHash?: string; refreshExpires?: Date;
}
export interface FplChallenge {
  _id: Types.ObjectId; challengeHash: string; codeHash: string; fplId: number;
  expiresAt: Date; attempts: number; consumedAt?: Date;
}
export interface League {
  _id: Types.ObjectId; fplId: number; name: string; syncing: boolean;
  importedAt?: Date; lastSyncedAt?: Date; active: boolean; pricingFromGw: number;
}
export interface Manager {
  _id: Types.ObjectId; leagueId: Types.ObjectId; fplId: number; name: string;
  rank: number; gwPoints: number; form: number; price: number; active: boolean;
  history: { gw: number; points: number; rank: number }[];
}
export interface Team {
  _id: Types.ObjectId; userId: Types.ObjectId; leagueId: Types.ObjectId;
  name: string; format: 5 | 7 | 11; managerIds: Types.ObjectId[];
  captainId: Types.ObjectId; budget: number; spent: number; points: number; rank: number;
  createdAt: Date; updatedAt: Date;
}
export interface Member {
  _id: Types.ObjectId; teamId: Types.ObjectId; managerId: Types.ObjectId; captain: boolean;
}
export interface Gameweek {
  _id: Types.ObjectId; id: number; deadline: Date; finished: boolean; current: boolean;
  dataChecked: boolean; snapshotsCaptured: boolean; processingComplete: boolean;
}
export interface Score {
  _id: Types.ObjectId; teamId: Types.ObjectId; leagueId: Types.ObjectId;
  userId: Types.ObjectId; gw: number; teamName: string; pseudo: string;
  managerIds: Types.ObjectId[]; captainId: Types.ObjectId; capturedAt: Date;
  points: number; scored: boolean; overallPoints?: number; rank?: number; teamValue?: number;
}
export interface Price {
  _id: Types.ObjectId; leagueId: Types.ObjectId; managerId: Types.ObjectId;
  gw: number; price: number; delta: number;
}
export interface Ranking {
  _id: Types.ObjectId; leagueId: Types.ObjectId; teamId: Types.ObjectId;
  gw: number; rank: number; teamName: string; pseudo: string; points: number;
}

const oid = { type: Schema.Types.ObjectId, required: true };
const number = { type: Number, required: true };
const text = { type: String, required: true };

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  connection!: Connection;
  users!: Model<User>;
  challenges!: Model<FplChallenge>;
  leagues!: Model<League>;
  managers!: Model<Manager>;
  teams!: Model<Team>;
  members!: Model<Member>;
  gameweeks!: Model<Gameweek>;
  scores!: Model<Score>;
  prices!: Model<Price>;
  rankings!: Model<Ranking>;
  constructor(private readonly config: Config) {}

  async onModuleInit() {
    this.connection = await mongoose.createConnection(this.config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    }).asPromise();
    this.users = this.model<User>('users', {
      fplId: { type: Number, min: 1, unique: true, sparse: true }, pseudo: text,
      fplProfile: {
        id: Number, firstName: String, lastName: String, teamName: String,
        overallPoints: Number, overallRank: Number, gameweekPoints: Number, gameweekRank: Number,
        favoriteTeam: {
          type: new Schema({ id: Number, name: String }, { _id: false }), default: null,
        },
        leagues: [{ _id: false, id: Number, name: String, rank: { type: Number, default: null } }],
      },
      role: { type: String, enum: ['user', 'admin'], default: 'user' },
      disabled: { type: Boolean, default: false }, avatar: String, favoriteTeam: String,
      tokenVersion: { type: Number, default: 0 }, refreshHash: String, refreshExpires: Date,
    });
    // The legacy email unique index rejects multiple new FPL-only users with no email.
    const userCollection = this.connection.collection('users');
    const indexes = await userCollection.indexes().catch((error) => {
      if (error.code === 26) return [];
      throw error;
    });
    const legacyEmailIndex = indexes.find((index) => index.name === 'email_1');
    if (legacyEmailIndex) {
      if (legacyEmailIndex.unique !== true || legacyEmailIndex.key.email !== 1
        || Object.keys(legacyEmailIndex.key).length !== 1) {
        throw new Error('Unexpected users.email_1 definition; review migration before startup');
      }
      await userCollection.dropIndex('email_1');
    }
    this.challenges = this.model<FplChallenge>('fpl_auth_challenges', {
      challengeHash: { ...text, unique: true }, codeHash: text, fplId: number,
      expiresAt: { type: Date, required: true }, attempts: { type: Number, default: 0 }, consumedAt: Date,
    }, [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
    this.leagues = this.model<League>('fpl_leagues', {
      fplId: { ...number, unique: true }, name: text, syncing: { type: Boolean, default: false },
      importedAt: Date, lastSyncedAt: Date, active: { type: Boolean, default: false },
      pricingFromGw: { type: Number, default: 1 },
    });
    this.managers = this.model<Manager>('fpl_managers', {
      leagueId: oid, fplId: number, name: text, rank: number,
      gwPoints: number, form: number, price: number, active: { type: Boolean, default: true },
      history: [{ _id: false, gw: number, points: number, rank: number }],
    }, [[{ leagueId: 1, fplId: 1 }, { unique: true }]]);
    this.teams = this.model<Team>('fantasy_teams', {
      userId: oid, leagueId: oid, name: text, format: { ...number, enum: [5, 7, 11] },
      managerIds: [{ type: Schema.Types.ObjectId, required: true }], captainId: oid,
      budget: number, spent: number, points: { type: Number, default: 0 },
      rank: { type: Number, default: 0 },
    }, [[{ userId: 1, leagueId: 1 }, { unique: true }]], true);
    this.members = this.model<Member>('team_members', {
      teamId: oid, managerId: oid, captain: { type: Boolean, required: true },
    }, [[{ teamId: 1, managerId: 1 }, { unique: true }]]);
    this.gameweeks = this.model<Gameweek>('gameweeks', {
      id: { ...number, unique: true }, deadline: { type: Date, required: true },
      finished: { type: Boolean, default: false }, current: { type: Boolean, default: false },
      dataChecked: { type: Boolean, default: false },
      snapshotsCaptured: { type: Boolean, default: false },
      processingComplete: { type: Boolean, default: false },
    });
    this.scores = this.model<Score>('scores', {
      teamId: oid, leagueId: oid, userId: oid, gw: number, teamName: text, pseudo: text,
      managerIds: [{ type: Schema.Types.ObjectId, required: true }], captainId: oid,
      capturedAt: { type: Date, required: true }, points: { type: Number, default: 0 },
      scored: { type: Boolean, default: false },
      overallPoints: Number, rank: Number, teamValue: Number,
    }, [[{ teamId: 1, gw: 1 }, { unique: true }], [{ leagueId: 1, gw: 1, scored: 1 }, {}]]);
    this.prices = this.model<Price>('market_prices', {
      leagueId: oid, managerId: oid, gw: number, price: number, delta: number,
    }, [[{ managerId: 1, gw: 1 }, { unique: true }]]);
    this.rankings = this.model<Ranking>('rankings', {
      leagueId: oid, teamId: oid, gw: number, rank: number, teamName: text,
      pseudo: text, points: number,
    }, [[{ leagueId: 1, gw: 1, teamId: 1 }, { unique: true }]]);
    await Promise.all(Object.values(this.connection.models).map((model) => model.init()));
    await this.connection.collection('operations').createIndex({ key: 1 }, { unique: true });
  }

  private model<T>(
    name: string, definition: Record<string, unknown>,
    indexes: [Record<string, 1 | -1>, Record<string, unknown>][] = [], timestamps = false,
  ): Model<T> {
    const schema = new Schema<T>(definition as never, { collection: name, timestamps });
    for (const [keys, options] of indexes) schema.index(keys, options);
    return this.connection.model<T>(name, schema);
  }

  async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.connection.transaction(work);
  }

  async onModuleDestroy() { await this.connection?.close(); }
}

@Global()
@Module({ providers: [Config, Database, FplClient], exports: [Config, Database, FplClient] })
export class InfrastructureModule {}
