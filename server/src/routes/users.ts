import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { assembleFullUser, replaceUserData } from '../userStore.js';

export const usersRouter = Router();

const cardIdPattern = /^[a-zA-Z0-9._-]+$/;

const userCardSchema = z.object({
  isOwned: z.boolean().optional(),
  isForTrade: z.boolean().optional(),
  variations: z.record(z.string(), z.any()).default({}),
});

const folderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  cardIds: z.array(z.string().regex(cardIdPattern)).max(5000),
});

const userDataSchema = z.object({
  username: z.string().trim().min(1).max(40),
  avatarUrl: z.string().trim().max(2000),
  ownedCards: z.record(z.string().regex(cardIdPattern), userCardSchema).default({}),
  friends: z.array(z.string().trim().min(1).max(60)).max(500).default([]),
  folders: z.array(folderSchema).max(200).default([]),
  wishlist: z.array(z.string().regex(cardIdPattern)).max(5000).default([]),
});

usersRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const user = assembleFullUser(req.userId!);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  return res.json({ user });
});

usersRouter.put('/me', requireAuth, (req: AuthedRequest, res) => {
  const parsed = userDataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.flatten() });
  }

  replaceUserData(req.userId!, parsed.data);

  const user = assembleFullUser(req.userId!);
  return res.json({ user });
});
