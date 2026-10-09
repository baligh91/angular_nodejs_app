import type { Request, Response } from 'express';

const { handler } = require('../../backend/dist/vercel') as {
  handler: (req: Request, res: Response) => Promise<void>;
};

module.exports = handler;
