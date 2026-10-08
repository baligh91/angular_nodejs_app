import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import mongoose, { Connection, Model, Schema, Types } from 'mongoose';
import { Config } from './config';
import { FplClient, FplLeague } from './fpl';

export interface User {
  _id: Types.ObjectId; fplId: number; firstName: string; lastName: string;
  fplTeamName: string; fplLeagues: FplLeague[]; passwordHash: string;
  disabled: boolean; tokenVersion: number;
  refreshHash?: string; refreshExpires?: Date; team?: UserTeam;
  scoreHistory: UserScore[]; totalScore: number;
}
export interface UserTeam {
  name: string; leagueFplId: number; leagueName: string; format: 5; firstScoringGw: number;
  managerIds: number[]; captainId: number; budget: number; spent: number;
  managers: { fplId: number; name: string; rank: number; price: number }[];
  pendingSnapshots: { gw: number; managerIds: number[]; captainId: number; teamName: string; capturedAt: Date }[];
}
export interface UserScore {
  gw: number; points: number; total: number; managerIds: number[];
  captainId: number; teamName: string; capturedAt: Date;
}
const number = { type: Number, required: true };
const text = { type: String, required: true };

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  connection!: Connection;
  users!: Model<User>;
  constructor(private readonly config: Config) {}

  async onModuleInit() {
    this.connection = await mongoose.createConnection(this.config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    }).asPromise();
      this.users = this.model<User>('users', {
        fplId: { ...number, min: 1 }, firstName: text, lastName: text,
        fplTeamName: text, passwordHash: { ...text, select: false },
        disabled: { type: Boolean, default: false },
        fplLeagues: { type: [{ _id: false, id: Number, name: String }], default: [] },
        tokenVersion: { type: Number, default: 0 }, refreshHash: String, refreshExpires: Date,
        team: {
          name: String, leagueFplId: Number, leagueName: String, format: { type: Number, enum: [5] }, firstScoringGw: Number,
          managerIds: [Number], captainId: Number, budget: Number, spent: Number,
          managers: [{ _id: false, fplId: Number, name: String, rank: Number, price: Number }],
          pendingSnapshots: [{ _id: false, gw: Number, managerIds: [Number], captainId: Number, teamName: String, capturedAt: Date }],
        },
        scoreHistory: [{ _id: false, gw: Number, points: Number, total: Number,
          managerIds: [Number], captainId: Number, teamName: String, capturedAt: Date }],
        totalScore: { type: Number, default: 0 },
      }, [[{ fplId: 1 }, { unique: true }]]);
      await this.users.init();
  }

  private model<T>(
    name: string, definition: Record<string, unknown>,
    indexes: [Record<string, 1 | -1>, Record<string, unknown>][] = [], timestamps = false,
  ): Model<T> {
    const schema = new Schema<T>(definition as never, { collection: name, timestamps });
    for (const [keys, options] of indexes) schema.index(keys, options);
    return this.connection.model<T>(name, schema);
  }

  async onModuleDestroy() { await this.connection?.close(); }
}

@Global()
@Module({ providers: [Config, Database, FplClient], exports: [Config, Database, FplClient] })
export class InfrastructureModule {}
