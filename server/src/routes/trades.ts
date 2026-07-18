import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
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
  quantity: z.number().int().positive().max(9999),
});

const createTradeSchema = z.object({
  recipientId: z.string().uuid(),
  folderId: z.string().min(1).max(80),
  items: z.array(itemSelectionSchema).min(1).max(200),
});

const getUsernameStmt = db.prepare(`SELECT username FROM users WHERE id = ?`);
function usernameOf(userId: string): string {
  const row = getUsernameStmt.get(userId) as { username: string } | undefined;
  return row?.username || 'Treinador';
}

function serializeTrade(trade: Trade) {
  return {
    ...trade,
    initiatorUsername: usernameOf(trade.initiatorId),
    recipientUsername: usernameOf(trade.recipientId),
    requestedValue: tradeItemsValue(trade.requestedItems),
    offeredValue: tradeItemsValue(trade.offeredItems),
  };
}

// Resolve as seleções (cardId/variação/condição/quantidade) do request contra os
// dados reais do dono, validando disponibilidade e capturando o preço daquela
// condição específica no momento da negociação.
function resolveItems(ownerId: string, selections: z.infer<typeof itemSelectionSchema>[]): TradeItem[] {
  return selections.map((sel) => {
    const entries = getVariationEntries(ownerId, sel.cardId);
    const match = entries.find((e) => e.variation === sel.variation && e.condition === sel.condition);
    if (!match) {
      throw new Error(`Carta ${sel.cardId} (${sel.variation}/${sel.condition}) indisponível.`);
    }
    if (sel.quantity > match.quantity) {
      throw new Error(
        `Só há ${match.quantity} unidade(s) de ${sel.cardId} (${sel.variation}/${sel.condition}) disponível(is).`
      );
    }
    return {
      cardId: sel.cardId,
      variation: sel.variation,
      condition: sel.condition,
      quantity: sel.quantity,
      unitPrice: match.price,
    };
  });
}

tradesRouter.post('/', requireAuth, (req: AuthedRequest, res) => {
  const parsed = createTradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos.' });
  }
  const { recipientId, folderId, items } = parsed.data;
  const myId = req.userId!;

  if (recipientId === myId) {
    return res.status(400).json({ error: 'Você não pode iniciar uma troca consigo mesmo.' });
  }
  if (!areFriends(myId, recipientId)) {
    return res.status(403).json({ error: 'Vocês não são amigos.' });
  }

  const visibleFolders = getVisibleFolders(recipientId);
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
    requestedItems = resolveItems(recipientId, items);
  } catch (err: any) {
    return res.status(409).json({ error: err.message });
  }

  const trade = createTrade(myId, recipientId, requestedItems);
  return res.status(201).json({ trade: serializeTrade(trade) });
});

tradesRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const trades = getTradesForUser(req.userId!).map(serializeTrade);
  return res.json({ trades });
});

const submitOfferSchema = z.object({
  action: z.literal('submit_offer'),
  items: z.array(itemSelectionSchema).min(1).max(200),
});
const simpleActionSchema = z.object({
  action: z.enum(['choose_payment', 'choose_offer', 'confirm', 'cancel']),
});
const patchSchema = z.union([submitOfferSchema, simpleActionSchema]);

tradesRouter.patch('/:id', requireAuth, (req: AuthedRequest, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  const trade = getTrade(req.params.id);
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
      saveTrade(trade);
      return res.json({ trade: serializeTrade(trade) });
    }

    if (action === 'choose_offer') {
      if (!isRecipient) return res.status(403).json({ error: 'Apenas quem recebeu o pedido pode escolher esta opção.' });
      if (trade.status !== 'pending_response') return res.status(409).json({ error: 'Essa troca não está mais pendente.' });
      trade.status = 'selecting_offer';
      saveTrade(trade);
      return res.json({ trade: serializeTrade(trade) });
    }

    if (action === 'submit_offer') {
      if (!isRecipient) return res.status(403).json({ error: 'Apenas quem recebeu o pedido pode escolher as cartas do amigo.' });
      if (trade.status !== 'selecting_offer') return res.status(409).json({ error: 'Essa troca não está aguardando uma oferta.' });

      const visibleFolders = getVisibleFolders(trade.initiatorId);
      const availableCardIds = new Set(visibleFolders.flatMap((f) => f.cards.map((c) => c.cardId)));
      const { items } = parsed.data as z.infer<typeof submitOfferSchema>;
      if (items.some((item) => !availableCardIds.has(item.cardId))) {
        return res.status(400).json({ error: 'Alguma carta escolhida não está mais disponível para troca.' });
      }

      trade.offeredItems = resolveItems(trade.initiatorId, items);
      trade.status = 'awaiting_value_diff_confirmation';
      trade.initiatorConfirmed = false;
      trade.recipientConfirmed = false;
      saveTrade(trade);
      return res.json({ trade: serializeTrade(trade) });
    }

    if (action === 'confirm') {
      if (trade.status !== 'awaiting_payment_confirmation' && trade.status !== 'awaiting_value_diff_confirmation') {
        return res.status(409).json({ error: 'Essa troca não está aguardando confirmação.' });
      }
      if (isInitiator) trade.initiatorConfirmed = true;
      if (isRecipient) trade.recipientConfirmed = true;

      if (trade.initiatorConfirmed && trade.recipientConfirmed) {
        finalizeTrade(trade);
      } else {
        saveTrade(trade);
      }
      return res.json({ trade: serializeTrade(trade) });
    }

    if (action === 'cancel') {
      if (trade.status === 'completed' || trade.status === 'cancelled') {
        return res.status(409).json({ error: 'Essa troca já foi encerrada.' });
      }
      trade.status = 'cancelled';
      saveTrade(trade);
      return res.json({ trade: serializeTrade(trade) });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (err: any) {
    return res.status(409).json({ error: err.message || 'Não foi possível concluir a ação.' });
  }
});
