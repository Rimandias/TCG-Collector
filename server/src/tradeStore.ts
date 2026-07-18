import crypto from 'node:crypto';
import { db } from './db.js';

export interface VariationEntry {
  variation: string;
  condition: string;
  quantity: number;
  price: number;
}

export interface TradeItem {
  cardId: string;
  variation: string;
  condition: string;
  quantity: number;
  unitPrice: number;
}

export type TradeStatus =
  | 'pending_response'
  | 'awaiting_payment_confirmation'
  | 'selecting_offer'
  | 'awaiting_value_diff_confirmation'
  | 'completed'
  | 'cancelled';

export interface Trade {
  id: string;
  initiatorId: string;
  recipientId: string;
  status: TradeStatus;
  requestedItems: TradeItem[];
  offeredItems: TradeItem[];
  initiatorConfirmed: boolean;
  recipientConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

const isFriendStmt = db.prepare(`SELECT 1 FROM friends WHERE user_id = ? AND friend_user_id = ?`);
export function areFriends(userId: string, otherId: string): boolean {
  return !!isFriendStmt.get(userId, otherId);
}

const getUserCardStmt = db.prepare(`SELECT variations FROM user_cards WHERE user_id = ? AND card_id = ?`);

function parsePrice(raw: any): number {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

// Retorna as combinações variação/condição com quantidade > 0 que o usuário possui de uma carta.
export function getVariationEntries(userId: string, cardId: string): VariationEntry[] {
  const row = getUserCardStmt.get(userId, cardId) as { variations: string } | undefined;
  if (!row) return [];
  const variations = JSON.parse(row.variations || '{}');
  const entries: VariationEntry[] = [];
  for (const [variation, conditions] of Object.entries<any>(variations || {})) {
    if (!conditions || typeof conditions !== 'object') continue;
    for (const [condition, details] of Object.entries<any>(conditions)) {
      const quantity = typeof details?.quantity === 'number' ? details.quantity : 0;
      if (quantity > 0) {
        entries.push({ variation, condition, quantity, price: parsePrice(details?.price) });
      }
    }
  }
  return entries;
}

const getVisibleFoldersStmt = db.prepare(`
  SELECT id, name FROM trade_folders WHERE user_id = ? AND visible_to_friends = 1
`);
const getFolderCardIdsStmt = db.prepare(`SELECT card_id FROM trade_folder_cards WHERE folder_id = ?`);

export interface VisibleFolder {
  id: string;
  name: string;
  cards: { cardId: string; items: VariationEntry[] }[];
}

// Pastas de um amigo marcadas como visíveis, com a quantidade/condição/preço reais das cartas nelas.
export function getVisibleFolders(friendUserId: string): VisibleFolder[] {
  const folders = getVisibleFoldersStmt.all(friendUserId) as { id: string; name: string }[];
  return folders.map((folder) => {
    const cardIds = (getFolderCardIdsStmt.all(folder.id) as { card_id: string }[]).map((r) => r.card_id);
    const cards = cardIds
      .map((cardId) => ({ cardId, items: getVariationEntries(friendUserId, cardId) }))
      .filter((c) => c.items.length > 0);
    return { id: folder.id, name: folder.name, cards };
  });
}

function parseTradeRow(row: any): Trade {
  return {
    id: row.id,
    initiatorId: row.initiator_id,
    recipientId: row.recipient_id,
    status: row.status,
    requestedItems: JSON.parse(row.requested_items || '[]'),
    offeredItems: JSON.parse(row.offered_items || '[]'),
    initiatorConfirmed: !!row.initiator_confirmed,
    recipientConfirmed: !!row.recipient_confirmed,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const insertTradeStmt = db.prepare(`
  INSERT INTO trades (id, initiator_id, recipient_id, status, requested_items, offered_items, initiator_confirmed, recipient_confirmed, created_at, updated_at)
  VALUES (?, ?, ?, 'pending_response', ?, '[]', 0, 0, ?, ?)
`);

export function createTrade(initiatorId: string, recipientId: string, requestedItems: TradeItem[]): Trade {
  const id = crypto.randomUUID();
  const now = Date.now();
  insertTradeStmt.run(id, initiatorId, recipientId, JSON.stringify(requestedItems), now, now);
  return getTrade(id)!;
}

const getTradeStmt = db.prepare(`SELECT * FROM trades WHERE id = ?`);
export function getTrade(id: string): Trade | null {
  const row = getTradeStmt.get(id);
  return row ? parseTradeRow(row) : null;
}

const getTradesForUserStmt = db.prepare(`
  SELECT * FROM trades WHERE initiator_id = ? OR recipient_id = ? ORDER BY updated_at DESC
`);
export function getTradesForUser(userId: string): Trade[] {
  return (getTradesForUserStmt.all(userId, userId) as any[]).map(parseTradeRow);
}

const updateTradeStmt = db.prepare(`
  UPDATE trades SET
    status = ?, requested_items = ?, offered_items = ?,
    initiator_confirmed = ?, recipient_confirmed = ?, updated_at = ?
  WHERE id = ?
`);
export function saveTrade(trade: Trade) {
  updateTradeStmt.run(
    trade.status,
    JSON.stringify(trade.requestedItems),
    JSON.stringify(trade.offeredItems),
    trade.initiatorConfirmed ? 1 : 0,
    trade.recipientConfirmed ? 1 : 0,
    Date.now(),
    trade.id
  );
}

export function tradeItemsValue(items: TradeItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

const getCardStmt = db.prepare(`SELECT is_for_trade, variations FROM user_cards WHERE user_id = ? AND card_id = ?`);
const upsertCardStmt = db.prepare(`
  INSERT INTO user_cards (user_id, card_id, is_owned, is_for_trade, variations)
  VALUES (?, ?, 1, 0, ?)
  ON CONFLICT(user_id, card_id) DO UPDATE SET is_owned = 1, variations = excluded.variations
`);
const clearOwnedFlagsStmt = db.prepare(`
  UPDATE user_cards SET is_owned = 0, is_for_trade = 0 WHERE user_id = ? AND card_id = ?
`);

function totalQuantity(variations: any): number {
  let total = 0;
  for (const conditions of Object.values<any>(variations || {})) {
    for (const details of Object.values<any>(conditions || {})) {
      total += typeof details?.quantity === 'number' ? details.quantity : 0;
    }
  }
  return total;
}

// Move um conjunto de itens (carta/variação/condição/quantidade) de um usuário para outro,
// preservando a qualidade e o preço do dono original quando o destinatário ainda não tinha a carta.
function transferItems(fromUserId: string, toUserId: string, items: TradeItem[]) {
  for (const item of items) {
    const fromRow = getCardStmt.get(fromUserId, item.cardId) as { variations: string } | undefined;
    const fromVariations = fromRow ? JSON.parse(fromRow.variations || '{}') : {};
    const fromDetails = fromVariations?.[item.variation]?.[item.condition];
    const availableQty = typeof fromDetails?.quantity === 'number' ? fromDetails.quantity : 0;

    if (availableQty < item.quantity) {
      throw new Error(
        `Quantidade insuficiente de ${item.cardId} (${item.variation}/${item.condition}) para concluir a troca.`
      );
    }

    const remaining = availableQty - item.quantity;
    if (remaining > 0) {
      fromVariations[item.variation][item.condition] = { ...fromDetails, quantity: remaining };
    } else {
      delete fromVariations[item.variation][item.condition];
    }
    upsertCardStmt.run(fromUserId, item.cardId, JSON.stringify(fromVariations));

    // Se a quantidade total dessa carta zerou, tira as flags de posse/troca
    // (mesma regra usada no cliente ao esvaziar uma carta manualmente).
    if (totalQuantity(fromVariations) === 0) {
      clearOwnedFlagsStmt.run(fromUserId, item.cardId);
    }

    const toRow = getCardStmt.get(toUserId, item.cardId) as { variations: string } | undefined;
    const toVariations = toRow ? JSON.parse(toRow.variations || '{}') : {};
    if (!toVariations[item.variation]) toVariations[item.variation] = {};
    const existing = toVariations[item.variation][item.condition];
    const existingQty = typeof existing?.quantity === 'number' ? existing.quantity : 0;

    toVariations[item.variation][item.condition] =
      existingQty > 0
        ? { ...existing, quantity: existingQty + item.quantity }
        : { quantity: item.quantity, price: String(item.unitPrice) };

    upsertCardStmt.run(toUserId, item.cardId, JSON.stringify(toVariations));
  }
}

export function finalizeTrade(trade: Trade) {
  db.exec('BEGIN');
  try {
    transferItems(trade.recipientId, trade.initiatorId, trade.requestedItems);
    if (trade.offeredItems.length > 0) {
      transferItems(trade.initiatorId, trade.recipientId, trade.offeredItems);
    }
    trade.status = 'completed';
    saveTrade(trade);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
