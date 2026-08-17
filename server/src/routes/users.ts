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

// Diff de cartas (ver auth.ts persistUser/computeCardsDiff no frontend): em vez de mandar a
// coleção inteira a cada salvamento, o cliente manda só o que mudou desde o último
// salvamento confirmado - `changed` sempre é o valor final (não incremental), então reenviar
// o mesmo diff duas vezes (retry) é seguro. `ownedCards` continua aceito como alternativa
// (a importação de CSV em SettingsView.tsx ainda manda a coleção inteira, e serve de
// fallback pra sessões com frontend antigo em cache durante um deploy).
const cardsDiffSchema = z.object({
  changed: z.record(z.string().regex(cardIdPattern), userCardSchema).default({}),
  removed: z.array(z.string().regex(cardIdPattern)).max(20000).default([]),
});

const variationSelectionSchema = z.object({
  variation: z.string().min(1).max(80),
  condition: z.string().min(1).max(20),
  language: z.string().max(10).optional(),
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
  // Nenhum dos dois tem `.default()`: ausente precisa continuar significando "não mande
  // ownedCards/cardsDiff nesse payload", nunca virar um objeto vazio por acidente - um
  // `ownedCards: {}` sintético seria lido como "o usuário não tem carta nenhuma" e apagaria
  // a coleção inteira (ver replaceUserDataUnlocked).
  ownedCards: z.record(z.string().regex(cardIdPattern), userCardSchema).optional(),
  cardsDiff: cardsDiffSchema.optional(),
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

    // Nenhum caller no frontend usa o `User` que essa rota devolvia (App.tsx e
    // SettingsView.tsx só checam se o retorno é truthy) - devolver a coleção inteira de
    // volta a cada salvamento era banda jogada fora, ainda mais frequente que o GET /me
    // (dispara a cada edição, não só no login). Um ack mínimo é suficiente.
    await replaceUserData(req.userId!, parsed.data);
    return res.json({ ok: true });
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
