import { Router, Request, Response } from 'express';

const router = Router();

router.get('/home', (_req: Request, res: Response) => {
  res.render('home');
});

export default router;
