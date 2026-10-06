import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Database, InfrastructureModule } from './infrastructure/database';
import { seedFixtures } from './infrastructure/fixtures';

async function seed() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (process.env.NODE_ENV === 'production') throw new Error('Offline fixtures are forbidden in production');
  const app = await NestFactory.createApplicationContext(InfrastructureModule);
  try {
    await seedFixtures(app.get(Database));
    console.log('Seeded fixture FPL IDs 90000020 (player) and 90000001 (admin); league 999001. Use SYNC_ENABLED=false and an explicit local mocked FPL source for ownership verification.');
  } finally { await app.close(); }
}
seed().catch((error) => { console.error(error.message); process.exitCode = 1; });
