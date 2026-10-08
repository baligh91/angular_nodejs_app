import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { InfrastructureModule } from './infrastructure/database';
import { AuthGuard, AuthService } from './application/auth';
import { TeamService } from './application/team';
import { ScoringService } from './application/scoring';
import {
  AuthController, CronController, HealthController, TeamController,
} from './presentation/single-controller';

@Module({
  imports: [InfrastructureModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthGuard],
})
class AuthModule {}

@Module({
  imports: [InfrastructureModule],
  controllers: [TeamController],
  providers: [TeamService, ScoringService],
  exports: [TeamService, ScoringService],
})
class FantasyModule {}

@Module({
  imports: [
    InfrastructureModule, AuthModule, FantasyModule, JwtModule.register({}),
    ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [HealthController, CronController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
