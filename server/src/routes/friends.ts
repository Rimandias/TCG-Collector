import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { assembleFullUser } from '../userStore.js';
import { normalizeFriendCode } from '../friendCode.js';
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

const findUserByFriendCode = db.prepare(`SELECT id FROM users WHERE friend_code = ?`);
const findFriendship = db.prepare(`SELECT 1 FROM friends WHERE user_id = ? AND friend_user_id = ?`);
const insertFriendship = db.prepare(`
  INSERT OR IGNORE INTO friends (user_id, friend_user_id, added_at) VALUES (?, ?, ?)
`);
const deleteFriendship = db.prepare(`DELETE FROM friends WHERE user_id = ? AND friend_user_id = ?`);

friendsRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = addFriendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Código inválido.' });
  }

  const code = normalizeFriendCode(parsed.data.code);
  const target = findUserByFriendCode.get(code) as { id: string } | undefined;
  if (!target) {
    return res.status(404).json({ error: 'Nenhum usuário encontrado com esse código.' });
  }

  const myId = req.userId!;
  if (target.id === myId) {
    return res.status(400).json({ error: 'Você não pode adicionar a si mesmo como amigo.' });
  }

  if (findFriendship.get(myId, target.id)) {
    return res.status(409).json({ error: 'Vocês já são amigos.' });
  }

  const now = Date.now();
  db.exec('BEGIN');
  try {
    insertFriendship.run(myId, target.id, now);
    insertFriendship.run(target.id, myId, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const user = assembleFullUser(myId);
  return res.status(201).json({ user });
});

friendsRouter.get('/:friendUserId/folders', requireAuth, (req: AuthedRequest, res) => {
  const { friendUserId } = req.params;
  const myId = req.userId!;

  if (!areFriends(myId, friendUserId)) {
    return res.status(403).json({ error: 'Vocês não são amigos.' });
  }

  const folders = getVisibleFolders(friendUserId);
  return res.json({ folders });
});

friendsRouter.delete('/:friendUserId', requireAuth, (req: AuthedRequest, res) => {
  const { friendUserId } = req.params;
  const myId = req.userId!;

  db.exec('BEGIN');
  try {
    deleteFriendship.run(myId, friendUserId);
    deleteFriendship.run(friendUserId, myId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const user = assembleFullUser(myId);
  return res.json({ user });
});
