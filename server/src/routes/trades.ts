import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { supabase } from '../supabase.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  areFriends,
  createTrade,
  finalizeTrade,
  getTrade,
  getTradesForUser,
  getVariationEntries,
  getVisibleFolders,
  saveTrade,
  tradeItemsValue,
  type Trade,
  type TradeItem,
} from '../tradeStore.js';
import { asyncHandler } from '../asyncHandler.js';

export const tradesRouter = Router();

const tradesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
tradesRouter.use(tradesLimiter);

const cardIdPattern = /^[a-zA-Z0-9._-]+$/;
const itemSelectionSchema = z.object({
  cardId: z.string().regex(cardIdPattern),
  variation: z.string().min(1).max(40),
  condition: z.string().min(1).max(10),
  quantity: z.number().int().positive().max(10000),
});

const createTradeSchema = z.object({
  recipientId: z.string().uuid(),
  folderId: z.string().min(1).max(80),
  items: z.array(itemSelectionSchema).min(1).max(200),
});

async function usernameOf(userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle();
  return data?.username || 'Treinador';
}

async function serializeTrade(trade: Trade) {
  const [initiatorUsername, recipientUsername] = await Promise.all([
    usernameOf(trade.initiatorId),
    usernameOf(trade.recipientId),
  ]);
  return {
    ...trade,
    initiatorUsername,
    recipientUsername,
    requestedValue: tradeItemsValue(trade.requestedItems),
    offeredValue: tradeItemsValue(trade.offeredItems),
  };
}

// Resolve as seleções (cardId/variação/condição) do request contra os dados reais
// do dono, capturando quantidade e preço no momento da negociação.
async function resolveItems(
  ownerId: string,
  selections: z.infer<typeof itemSelectionSchema>[]
): Promise<TradeItem[]> {
  const items: TradeItem[] = [];
  for (const sel of selections) {
    const entries = await getVariationEntries(ownerId, sel.cardId);
    const match = entries.find((e) => e.variation === sel.variation && e.condition === sel.condition);
    if (!match || match.quantity < sel.quantity) {
      throw new Error(`Carta ${sel.cardId} (${sel.variation}/${sel.condition}) indisponível na quantidade pedida.`);
    }
    items.push({
      cardId: sel.cardId,
      variation: sel.variation,
      condition: sel.condition,
      quantity: sel.quantity,
      unitPrice: match.price,
    });
  }
  return items;
}

tradesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = createTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }
    const { recipientId, folderId, items } = parsed.data;
    const myId = req.userId!;

    if (recipientId === myId) {
      return res.status(400).json({ error: 'Você não pode iniciar uma troca consigo mesmo.' });
    }
    if (!(await areFriends(myId, recipientId))) {
      return res.status(403).json({ error: 'Vocês não são amigos.' });
    }

    const visibleFolders = await getVisibleFolders(recipientId);
    const folder = visibleFolders.find((f) => f.id === folderId);
    if (!folder) {
      return res.status(404).json({ error: 'Pasta não encontrada ou não está mais visível.' });
    }
    const folderCardIds = new Set(folder.cards.map((c) => c.cardId));
    if (items.some((item) => !folderCardIds.has(item.cardId))) {
      return res.status(400).json({ error: 'Alguma carta selecionada não pertence a essa pasta.' });
    }

    let requestedItems: TradeItem[];
    try {
      requestedItems = await resolveItems(recipientId, items);
    } catch (err: any) {
      return res.status(409).json({ error: err.message });
    }

    const trade = await createTrade(myId, recipientId, requestedItems);
    return res.status(201).json({ trade: await serializeTrade(trade) });
  })
);

tradesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const trades = await getTradesForUser(req.userId!);
    const serialized = await Promise.all(trades.map(serializeTrade));
    return res.json({ trades: serialized });
  })
);

const submitOfferSchema = z.object({
  action: z.literal('submit_offer'),
  items: z.array(itemSelectionSchema).min(1).max(200),
});
const simpleActionSchema = z.object({
  action: z.enum(['choose_payment', 'choose_offer', 'confirm', 'cancel']),
});
const patchSchema = z.union([submitOfferSchema, simpleActionSchema]);

tradesRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ação inválida.' });
    }

    const trade = await getTrade(req.params.id);
    if (!trade) {
      return res.status(404).json({ error: 'Troca não encontrada.' });
    }

    const myId = req.userId!;
    const isInitiator = trade.initiatorId === myId;
    const isRecipient = trade.recipientId === myId;
    if (!isInitiator && !isRecipient) {
      return res.status(403).json({ error: 'Você não participa dessa troca.' });
    }

    const { action } = parsed.data;

    try {
      if (action === 'choose_payment') {
        if (!isRecipient) return res.status(403).json({ error: 'Apenas quem recebeu o pedido pode escolher esta opção.' });
        if (trade.status !== 'pending_response') return res.status(409).json({ error: 'Essa troca não está mais pendente.' });
        trade.status = 'awaiting_payment_confirmation';
        trade.recipientConfirmed = true;
        trade.initiatorConfirmed = false;
        await saveTrade(trade);
        return res.json({ trade: await serializeTrade(trade) });
      }

      if (action === 'choose_offer') {
        if (!isRecipient) return res.status(403).json({ error: 'Apenas quem recebeu o pedido pode escolher esta opção.' });
        if (trade.status !== 'pending_response') return res.status(409).json({ error: 'Essa troca não está mais pendente.' });
        trade.status = 'selecting_offer';
        await saveTrade(trade);
        return res.json({ trade: await serializeTrade(trade) });
      }

      if (action === 'submit_offer') {
        if (!isRecipient) return res.status(403).json({ error: 'Apenas quem recebeu o pedido pode escolher as cartas do amigo.' });
        if (trade.status !== 'selecting_offer') return res.status(409).json({ error: 'Essa troca não está aguardando uma oferta.' });

        const visibleFolders = await getVisibleFolders(trade.initiatorId);
        const availableCardIds = new Set(visibleFolders.flatMap((f) => f.cards.map((c) => c.cardId)));
        const { items } = parsed.data as z.infer<typeof submitOfferSchema>;
        if (items.some((item) => !availableCardIds.has(item.cardId))) {
          return res.status(400).json({ error: 'Alguma carta escolhida não está mais disponível para troca.' });
        }

        trade.offeredItems = await resolveItems(trade.initiatorId, items);
        trade.status = 'awaiting_value_diff_confirmation';
        trade.initiatorConfirmed = false;
        trade.recipientConfirmed = false;
        await saveTrade(trade);
        return res.json({ trade: await serializeTrade(trade) });
      }

      if (action === 'confirm') {
        if (trade.status !== 'awaiting_payment_confirmation' && trade.status !== 'awaiting_value_diff_confirmation') {
          return res.status(409).json({ error: 'Essa troca não está aguardando confirmação.' });
        }
        if (isInitiator) trade.initiatorConfirmed = true;
        if (isRecipient) trade.recipientConfirmed = true;

        if (trade.initiatorConfirmed && trade.recipientConfirmed) {
          await finalizeTrade(trade);
        } else {
          await saveTrade(trade);
        }
        return res.json({ trade: await serializeTrade(trade) });
      }

      if (action === 'cancel') {
        if (trade.status === 'completed' || trade.status === 'cancelled') {
          return res.status(409).json({ error: 'Essa troca já foi encerrada.' });
        }
        trade.status = 'cancelled';
        await saveTrade(trade);
        return res.json({ trade: await serializeTrade(trade) });
      }

      return res.status(400).json({ error: 'Ação desconhecida.' });
    } catch (err: any) {
      return res.status(409).json({ error: err.message || 'Não foi possível concluir a ação.' });
    }
  })
);
