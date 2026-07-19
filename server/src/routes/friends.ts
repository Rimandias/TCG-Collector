import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { supabase } from '../supabase.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { assembleFullUser } from '../userStore.js';
import { normalizeFriendCode } from '../friendCode.js';
import { asyncHandler } from '../asyncHandler.js';
import { areFriends, getVisibleFolders } from '../tradeStore.js';

export const friendsRouter = Router();

const friendsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
friendsRouter.use(friendsLimiter);

const addFriendSchema = z.object({
  code: z.string().trim().min(4).max(20),
});

friendsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = addFriendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const code = normalizeFriendCode(parsed.data.code);
    const { data: target, error: targetErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('friend_code', code)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) {
      return res.status(404).json({ error: 'Nenhum usuário encontrado com esse código.' });
    }

    const myId = req.userId!;
    if (target.id === myId) {
      return res.status(400).json({ error: 'Você não pode adicionar a si mesmo como amigo.' });
    }

    const { data: existing, error: existingErr } = await supabase
      .from('friends')
      .select('user_id')
      .eq('user_id', myId)
      .eq('friend_user_id', target.id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      return res.status(409).json({ error: 'Vocês já são amigos.' });
    }

    const now = new Date().toISOString();
    const { error: insertErr } = await supabase.from('friends').insert([
      { user_id: myId, friend_user_id: target.id, added_at: now },
      { user_id: target.id, friend_user_id: myId, added_at: now },
    ]);
    if (insertErr) throw insertErr;

    const user = await assembleFullUser(myId, req.userEmail!);
    return res.status(201).json({ user });
  })
);

friendsRouter.get(
  '/:friendUserId/folders',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { friendUserId } = req.params;
    const myId = req.userId!;

    if (!(await areFriends(myId, friendUserId))) {
      return res.status(403).json({ error: 'Vocês não são amigos.' });
    }

    const folders = await getVisibleFolders(friendUserId);
    return res.json({ folders });
  })
);

friendsRouter.delete(
  '/:friendUserId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { friendUserId } = req.params;
    const myId = req.userId!;

    const { error: err1 } = await supabase.from('friends').delete().eq('user_id', myId).eq('friend_user_id', friendUserId);
    if (err1) throw err1;
    const { error: err2 } = await supabase.from('friends').delete().eq('user_id', friendUserId).eq('friend_user_id', myId);
    if (err2) throw err2;

    const user = await assembleFullUser(myId, req.userEmail!);
    return res.json({ user });
  })
);
