import 'reflect-metadata';
import type { Request, Response } from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

let appPromise: ReturnType<typeof createVercelApp> | undefined;

export function createVercelApp() {
  return NestFactory.create(AppModule, new ExpressAdapter()).then(async (app) => {
    configureApp(app);
    await app.init();
    return app;
  });
}

export async function handler(req: Request, res: Response) {
  appPromise ??= createVercelApp().catch((error) => {
    appPromise = undefined;
    throw error;
  });
  const app = await appPromise;
  app.getHttpAdapter().getInstance()(req, res);
}
