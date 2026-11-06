import { Router } from 'express';
import { registerSchema, loginSchema, logoutSchema } from '@syncboard/shared/schemas';
import { validate } from '../middleware/validate.js';
import { auth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/authController.js';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), ctrl.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), ctrl.login);
authRouter.post('/logout', validate({ body: logoutSchema }), ctrl.logout);
authRouter.get('/me', auth, ctrl.me);
