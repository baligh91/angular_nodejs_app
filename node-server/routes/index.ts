import express from 'express';

const router = express.Router();

router.get('/', (_request, response) => {
  response.send('Node.js TypeScript server is running');
});

export default router;