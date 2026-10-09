import 'reflect-metadata';
import { ExpressAdapter } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

export function createVercelApp() {
  return NestFactory.create(AppModule, new ExpressAdapter()).then(async (app) => {
    configureApp(app);
    await app.init();
    return app;
  });
}
