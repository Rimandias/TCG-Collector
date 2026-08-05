import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { supabase } from '../supabase.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../asyncHandler.js';

export const decksRouter = Router();

const decksLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
decksRouter.use(decksLimiter, requireAuth);

const MAX_DECKS = 5;
const MAX_DECK_CARDS = 60;

const cardIdPattern = /^[a-zA-Z0-9._-]+$/;
const deckCardSchema = z.object({
  cardId: z.string().regex(cardIdPattern),
  quantity: z.number().int().min(1).max(MAX_DECK_CARDS),
});
const deckCardsSchema = z.array(deckCardSchema).max(MAX_DECK_CARDS);
const deckNameSchema = z.string().trim().min(1).max(60);

interface DeckRow {
  id: string;
  name: string;
  created_at: string;
}

async function loadDeckCards(deckId: string): Promise<{ cardId: string; quantity: number }[]> {
  const { data, error } = await supabase.from('deck_cards').select('card_id, quantity').eq('deck_id', deckId);
  if (error) throw error;
  return (data || []).map((r) => ({ cardId: r.card_id, quantity: r.quantity }));
}

function serializeDeck(deck: DeckRow, cards: { cardId: string; quantity: number }[]) {
  return { id: deck.id, name: deck.name, createdAt: deck.created_at, cards };
}

// Substitui as cartas de um deck por diff (upsert + apagar só as removidas), nunca
// delete-then-insert - mesma razão do padrão em userStore.ts/syncKeyedTable: duas edições
// sobrepostas do mesmo deck não devem poder colidir em 23505.
async function replaceDeckCards(deckId: string, cards: { cardId: string; quantity: number }[]): Promise<void> {
  const keepIds = new Set(cards.map((c) => c.cardId));
  const [, existing] = await Promise.all([
    cards.length > 0
      ? supabase
          .from('deck_cards')
          .upsert(
            cards.map((c) => ({ deck_id: deckId, card_id: c.cardId, quantity: c.quantity })),
            { onConflict: 'deck_id,card_id' }
          )
          .then((r) => {
            if (r.error) throw r.error;
          })
      : Promise.resolve(),
    supabase.from('deck_cards').select('card_id').eq('deck_id', deckId),
  ]);
  if (existing.error) throw existing.error;
  const staleIds = (existing.data || []).map((r) => r.card_id).filter((id) => !keepIds.has(id));
  if (staleIds.length > 0) {
    const { error } = await supabase.from('deck_cards').delete().eq('deck_id', deckId).in('card_id', staleIds);
    if (error) throw error;
  }
}

async function getOwnedDeck(deckId: string, userId: string): Promise<DeckRow | null> {
  const { data, error } = await supabase.from('decks').select('id, name, created_at').eq('id', deckId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

decksRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { data: decks, error } = await supabase
      .from('decks')
      .select('id, name, created_at')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const serialized = await Promise.all((decks || []).map(async (deck) => serializeDeck(deck, await loadDeckCards(deck.id))));
    return res.json({ decks: serialized });
  })
);

decksRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsedName = deckNameSchema.safeParse(req.body?.name);
    if (!parsedName.success) {
      return res.status(400).json({ error: 'Nome inválido.' });
    }

    const { count, error: countErr } = await supabase
      .from('decks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId!);
    if (countErr) throw countErr;
    if ((count || 0) >= MAX_DECKS) {
      return res.status(409).json({ error: `Limite de ${MAX_DECKS} decks atingido.` });
    }

    const { data, error } = await supabase
      .from('decks')
      .insert({ user_id: req.userId!, name: parsedName.data })
      .select('id, name, created_at')
      .single();
    if (error) throw error;

    return res.status(201).json({ deck: serializeDeck(data, []) });
  })
);

const patchDeckSchema = z.object({
  name: deckNameSchema.optional(),
  cards: deckCardsSchema.optional(),
});

decksRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = patchDeckSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const deck = await getOwnedDeck(req.params.id, req.userId!);
    if (!deck) {
      return res.status(404).json({ error: 'Deck não encontrado.' });
    }

    const { name, cards } = parsed.data;

    if (cards) {
      const total = cards.reduce((sum, c) => sum + c.quantity, 0);
      if (total > MAX_DECK_CARDS) {
        return res.status(400).json({ error: `Um deck pode ter no máximo ${MAX_DECK_CARDS} cartas (esta lista soma ${total}).` });
      }
      await replaceDeckCards(deck.id, cards);
    }

    if (name !== undefined) {
      const { error } = await supabase.from('decks').update({ name, updated_at: new Date().toISOString() }).eq('id', deck.id);
      if (error) throw error;
    }

    const finalName = name ?? deck.name;
    const finalCards = cards ?? (await loadDeckCards(deck.id));
    return res.json({ deck: serializeDeck({ ...deck, name: finalName }, finalCards) });
  })
);

decksRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const deck = await getOwnedDeck(req.params.id, req.userId!);
    if (!deck) {
      return res.status(404).json({ error: 'Deck não encontrado.' });
    }
    const { error } = await supabase.from('decks').delete().eq('id', deck.id);
    if (error) throw error;
    return res.json({ ok: true });
  })
);
