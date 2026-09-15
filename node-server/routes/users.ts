import express from 'express';

const router = express.Router();

router.get('/', (_request, response) => {
  response.send('respond with a resource');
});

export default router;