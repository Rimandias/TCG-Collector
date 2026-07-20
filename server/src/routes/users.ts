import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { assembleFullUser, replaceUserData } from '../userStore.js';
import { asyncHandler } from '../asyncHandler.js';
import { supabase } from '../supabase.js';

export const usersRouter = Router();

const cardIdPattern = /^[a-zA-Z0-9._-]+$/;

const userCardSchema = z.object({
  isOwned: z.boolean().optional(),
  isForTrade: z.boolean().optional(),
  variations: z.record(z.string(), z.any()).default({}),
});

const variationSelectionSchema = z.object({
  variation: z.string().min(1).max(80),
  condition: z.string().min(1).max(20),
  quantity: z.number().int().min(0),
});

const folderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  cardIds: z.array(z.string().regex(cardIdPattern)).max(5000),
  visibleToFriends: z.boolean().default(false),
  variationSelections: z.record(z.string().regex(cardIdPattern), z.array(variationSelectionSchema).max(50)).default({}),
});

const userDataSchema = z.object({
  username: z.string().trim().min(1).max(40),
  avatarUrl: z.string().trim().max(2000),
  ownedCards: z.record(z.string().regex(cardIdPattern), userCardSchema).default({}),
  folders: z.array(folderSchema).max(200).default([]),
  wishlist: z.array(z.string().regex(cardIdPattern)).max(5000).default([]),
});

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await assembleFullUser(req.userId!, req.userEmail!);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ user });
  })
);

usersRouter.put(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = userDataSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.flatten() });
    }

    await replaceUserData(req.userId!, parsed.data);

    const user = await assembleFullUser(req.userId!, req.userEmail!);
    return res.json({ user });
  })
);

// A confirmação de senha acontece no cliente (reautenticação via supabase-js
// signInWithPassword) antes de chegar aqui — este endpoint só pode ser chamado
// por uma sessão Supabase autenticada, que já garante que é o próprio dono da conta.
// O ON DELETE CASCADE das FKs remove coleção, pastas, wishlist, amizades e trocas.
usersRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { error } = await supabase.auth.admin.deleteUser(req.userId!);
    if (error) throw error;
    return res.json({ ok: true });
  })
);
