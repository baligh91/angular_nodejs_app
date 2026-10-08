import 'reflect-metadata';
import { ExpressAdapter } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppModule } from '../backend/dist/app.module';
import { configureApp } from '../backend/dist/bootstrap';

let appPromise: ReturnType<typeof createApp> | undefined;

function createApp() {
  return NestFactory.create(AppModule, new ExpressAdapter()).then(async (app) => {
    configureApp(app);
    await app.init();
    return app;
  });
}

export default async function handler(req: Request, res: Response) {
  appPromise ??= createApp().catch((error) => {
    appPromise = undefined;
    throw error;
  });
  const app = await appPromise;
  app.getHttpAdapter().getInstance()(req, res);
}
