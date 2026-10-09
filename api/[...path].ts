import type { Request, Response } from 'express';

interface NestApplication {
  getHttpAdapter(): {
    getInstance(): (req: Request, res: Response) => void;
  };
}

const { createVercelApp } = require('../backend/dist/vercel') as {
  createVercelApp: () => Promise<NestApplication>;
};

let appPromise: ReturnType<typeof createVercelApp> | undefined;

module.exports = async function handler(req: Request, res: Response) {
  appPromise ??= createVercelApp().catch((error) => {
    appPromise = undefined;
    throw error;
  });
  const app = await appPromise;
  app.getHttpAdapter().getInstance()(req, res);
};
