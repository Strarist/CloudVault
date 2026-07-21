import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { WorkspaceType, WorkspaceRole } from '../models/types';
import { config } from '../config';
import { authenticateJWT } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Render Views (optional fallback for development)
router.get('/register', (_req: Request, res: Response) => {
  res.render('register');
});

router.get('/login', (_req: Request, res: Response) => {
  res.render('login');
});

// POST /auth/register
router.post(
  '/register',
  body('email').trim().isEmail().withMessage('A valid email address is required'),
  body('password')
    .trim()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
  body('username')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Username/Name must be at least 3 characters long'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({
        errors: errors.array(),
        message: 'Invalid registration inputs.',
      });
      return;
    }

    const { email, username, password } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({ error: 'A user with this email already exists.' });
      return;
    }

    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) {
      res.status(400).json({ error: 'This username is already taken.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      name: username,
      passwordHash,
    });

    // Automatically create PERSONAL workspace for the user
    const personalWorkspace = await Workspace.create({
      name: `${newUser.name}'s Workspace`,
      ownerId: newUser._id,
      type: WorkspaceType.PERSONAL,
      aiEnabled: false,
    });

    // Establish user as the OWNER of their personal workspace
    await WorkspaceMember.create({
      workspaceId: personalWorkspace._id,
      userId: newUser._id,
      role: WorkspaceRole.OWNER,
      joinedAt: new Date(),
    });

    // Strip passwordHash from response
    const responseUser = {
      _id: newUser._id,
      email: newUser.email,
      username: newUser.username,
      name: newUser.name,
      avatar: newUser.avatar,
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
    };

    res.status(201).json(responseUser);
  }),
);

// POST /auth/login
router.post(
  '/login',
  body('username').trim().isLength({ min: 3 }).withMessage('Username/email is required'),
  body('password')
    .trim()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({
        errors: errors.array(),
        message: 'Invalid login inputs.',
      });
      return;
    }

    const { username, password } = req.body;

    // Support logging in via email, canonical username, or display name
    const loginId = username.trim();
    const user = await User.findOne({
      $or: [
        { email: loginId.toLowerCase() },
        { username: loginId.toLowerCase() },
        { name: loginId },
      ],
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
      },
      config.JWT_SECRET,
      { expiresIn: '24h' },
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    const responseUser = {
      _id: user._id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
    };

    res.status(200).json({
      message: 'Logged in successfully.',
      user: responseUser,
    });
  }),
);

// POST /auth/logout
router.post(
  '/logout',
  asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie('token', {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.status(200).json({ message: 'Logged out successfully.' });
  }),
);

// GET /auth/me
router.get(
  '/me',
  asyncHandler(authenticateJWT),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }

    res.status(200).json({
      _id: user._id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }),
);

export default router;
