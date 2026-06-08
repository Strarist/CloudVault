import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model';
import { config } from '../config';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.get('/register', (_req: Request, res: Response) => {
  res.render('register');
});

router.post(
  '/register',
  body('email')
    .trim()
    .isEmail()
    .isLength({ min: 13 })
    .withMessage('Email must be at least 13 characters'),
  body('password')
    .trim()
    .isLength({ min: 5 })
    .withMessage('Password must be at least 5 characters'),
  body('username')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Username must be at least 3 characters'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({
        errors: errors.array(),
        message: 'Invalid Data',
      });
      return;
    }

    const { email, username, password } = req.body;

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      email,
      name: username,
      passwordHash,
    });

    res.json(newUser);
  }),
);

router.get('/login', (_req: Request, res: Response) => {
  res.render('login');
});

router.post(
  '/login',
  body('username')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Username must be at least 3 characters'),
  body('password')
    .trim()
    .isLength({ min: 5 })
    .withMessage('Password must be at least 5 characters'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({
        errors: errors.array(),
        message: 'Invalid Data',
      });
      return;
    }

    const { username, password } = req.body;
    const user = await User.findOne({ name: username });

    if (!user) {
      res.status(400).json({
        message: 'username or password is incorrect',
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);

    if (!isMatch) {
      res.status(400).json({
        message: 'username or password is incorrect',
      });
      return;
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        name: user.name,
      },
      config.JWT_SECRET,
    );

    res.cookie('token', token);
    res.send('Logged in');
  }),
);

export default router;
