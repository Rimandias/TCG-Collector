import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { env } from '../env.js';
import { assembleFullUser } from '../userStore.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

const registerSchema = z.object({
  username: z.string().trim().min(2).max(40),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(200),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

const insertUser = db.prepare(`
  INSERT INTO users (id, username, email, password_hash, avatar_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const findByEmail = db.prepare(`SELECT id, password_hash FROM users WHERE email = ?`);

function issueToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: '30d' });
}

authRouter.post('/register', authLimiter, (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.flatten() });
  }
  const { username, email, password } = parsed.data;

  const existing = findByEmail.get(email);
  if (existing) {
    return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  }

  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 12);
  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(email)}`;

  insertUser.run(id, username, email, passwordHash, avatarUrl, Date.now());

  const token = issueToken(id);
  const user = assembleFullUser(id);
  return res.status(201).json({ token, user });
});

authRouter.post('/login', authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }
  const { email, password } = parsed.data;

  const row = findByEmail.get(email) as { id: string; password_hash: string } | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  const token = issueToken(row.id);
  const user = assembleFullUser(row.id);
  return res.json({ token, user });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const user = assembleFullUser(req.userId!);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  return res.json({ user });
});
