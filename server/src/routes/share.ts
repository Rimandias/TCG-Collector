import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase } from '../supabase.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { getPublicFolderByToken, setFolderShareToken, getFolderShareToken } from '../tradeStore.js';

export const shareRouter = Router();

// As duas rotas de gerenciamento (criar/revogar) exigem login e dono da pasta - o limitador
// genérico do app basta pra elas. A leitura pública (GET /:token) é o único ponto da API sem
// nenhuma autenticação, então recebe um limitador próprio, mais apertado por IP (não há
// usuário logado pra distribuir o custo entre contas diferentes).
const manageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

shareRouter.post(
  '/folders/:folderId',
  manageLimiter,
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { folderId } = req.params;
    const userId = req.userId!;

    const existing = await getFolderShareToken(userId, folderId);
    if (existing === undefined) {
      return res.status(404).json({ error: 'Pasta não encontrada.' });
    }
    if (existing) {
      return res.json({ token: existing });
    }

    const token = randomUUID();
    const ok = await setFolderShareToken(userId, folderId, token);
    if (!ok) {
      return res.status(404).json({ error: 'Pasta não encontrada.' });
    }
    return res.status(201).json({ token });
  })
);

shareRouter.delete(
  '/folders/:folderId',
  manageLimiter,
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { folderId } = req.params;
    const userId = req.userId!;
    const ok = await setFolderShareToken(userId, folderId, null);
    if (!ok) {
      return res.status(404).json({ error: 'Pasta não encontrada.' });
    }
    return res.json({ ok: true });
  })
);

// Único endpoint da API acessível sem `Authorization` - devolve só o necessário pra exibir a
// pasta (nome, cartas visíveis) e um recorte mínimo do perfil do dono (nome, avatar, código de
// amigo), nunca o FullUser inteiro, nem e-mail, outras pastas ou lista de amigos.
shareRouter.get(
  '/:token',
  publicLimiter,
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const folder = await getPublicFolderByToken(token);
    if (!folder) {
      return res.status(404).json({ error: 'Link inválido ou expirado.' });
    }

    const { data: owner, error: ownerErr } = await supabase
      .from('profiles')
      .select('username, avatar_url, friend_code')
      .eq('id', folder.ownerUserId)
      .maybeSingle();
    if (ownerErr) throw ownerErr;
    if (!owner) {
      return res.status(404).json({ error: 'Link inválido ou expirado.' });
    }

    return res.json({
      folderName: folder.name,
      cards: folder.cards,
      owner: {
        username: owner.username,
        avatarUrl: owner.avatar_url,
        friendCode: owner.friend_code,
      },
    });
  })
);
