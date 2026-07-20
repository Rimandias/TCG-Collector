import { supabase } from './supabase.js';

export interface VariationEntry {
  variation: string;
  condition: string;
  // Ausente = carta sem idioma detalhado (comportamento legado); presente = uma
  // combinação variação/condição/idioma específica (ver ConditionDetails.languages).
  language?: string;
  quantity: number;
  price: number;
}

export interface TradeItem {
  cardId: string;
  variation: string;
  condition: string;
  language?: string;
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

export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('friends')
    .select('user_id')
    .eq('user_id', userId)
    .eq('friend_user_id', otherId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

function parsePrice(raw: any): number {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

function entriesFromVariations(variations: any): VariationEntry[] {
  const entries: VariationEntry[] = [];
  for (const [variation, conditions] of Object.entries<any>(variations || {})) {
    if (!conditions || typeof conditions !== 'object') continue;
    for (const [condition, details] of Object.entries<any>(conditions)) {
      const languages = details?.languages;
      if (languages && typeof languages === 'object' && Object.keys(languages).length > 0) {
        // Condição detalhada por idioma (ver +Info): uma entrada por idioma, cada
        // uma com sua própria quantidade/preço - não uma entrada agregada só.
        for (const [language, langDetails] of Object.entries<any>(languages)) {
          const quantity = typeof langDetails?.quantity === 'number' ? langDetails.quantity : 0;
          if (quantity > 0) {
            entries.push({ variation, condition, language, quantity, price: parsePrice(langDetails?.price) });
          }
        }
        continue;
      }
      const quantity = typeof details?.quantity === 'number' ? details.quantity : 0;
      if (quantity > 0) {
        entries.push({ variation, condition, quantity, price: parsePrice(details?.price) });
      }
    }
  }
  return entries;
}

// Retorna as combinações variação/condição com quantidade > 0 que o usuário possui de uma carta.
export async function getVariationEntries(userId: string, cardId: string): Promise<VariationEntry[]> {
  const { data, error } = await supabase
    .from('user_cards')
    .select('variations')
    .eq('user_id', userId)
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return [];
  return entriesFromVariations(data.variations);
}

export interface VisibleFolder {
  id: string;
  name: string;
  cards: { cardId: string; items: VariationEntry[] }[];
}

// Restringe as entradas de uma carta às combinações variação/condição selecionadas para a
// pasta (quando houver seleção configurada), limitando a quantidade exposta à quantidade
// realmente possuída. Sem seleção configurada para o cardId, expõe todas as combinações
// (comportamento anterior, mantido por compatibilidade).
function applySelection(
  entries: VariationEntry[],
  selections?: { variation: string; condition: string; language?: string; quantity: number }[]
): VariationEntry[] {
  if (!selections || selections.length === 0) return entries;
  const result: VariationEntry[] = [];
  for (const sel of selections) {
    const owned = entries.find(
      (e) => e.variation === sel.variation && e.condition === sel.condition && (e.language || '') === (sel.language || '')
    );
    if (!owned) continue;
    const quantity = Math.min(sel.quantity, owned.quantity);
    if (quantity > 0) result.push({ ...owned, quantity });
  }
  return result;
}

// Pastas de um amigo marcadas como visíveis, com a quantidade/condição/preço reais das cartas nelas.
export async function getVisibleFolders(friendUserId: string): Promise<VisibleFolder[]> {
  const { data: folders, error } = await supabase
    .from('trade_folders')
    .select('id, name, variation_selections')
    .eq('user_id', friendUserId)
    .eq('visible_to_friends', true);
  if (error) throw error;
  if (!folders || folders.length === 0) return [];

  const folderIds = folders.map((f) => f.id);
  const { data: folderCards, error: fcError } = await supabase
    .from('trade_folder_cards')
    .select('folder_id, card_id')
    .in('folder_id', folderIds);
  if (fcError) throw fcError;

  const cardIdsByFolder: Record<string, string[]> = {};
  for (const row of folderCards || []) {
    (cardIdsByFolder[row.folder_id] ||= []).push(row.card_id);
  }

  const { data: userCardsRows, error: ucError } = await supabase
    .from('user_cards')
    .select('card_id, variations')
    .eq('user_id', friendUserId);
  if (ucError) throw ucError;
  const variationsByCard: Record<string, any> = {};
  for (const row of userCardsRows || []) {
    variationsByCard[row.card_id] = row.variations;
  }

  return folders.map((folder) => {
    const cardIds = cardIdsByFolder[folder.id] || [];
    const variationSelections = (folder as any).variation_selections || {};
    const cards = cardIds
      .map((cardId) => ({
        cardId,
        items: applySelection(entriesFromVariations(variationsByCard[cardId]), variationSelections[cardId]),
      }))
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
    requestedItems: row.requested_items || [],
    offeredItems: row.offered_items || [],
    initiatorConfirmed: row.initiator_confirmed,
    recipientConfirmed: row.recipient_confirmed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createTrade(initiatorId: string, recipientId: string, requestedItems: TradeItem[]): Promise<Trade> {
  const { data, error } = await supabase
    .from('trades')
    .insert({
      initiator_id: initiatorId,
      recipient_id: recipientId,
      status: 'pending_response',
      requested_items: requestedItems,
      offered_items: [],
      initiator_confirmed: false,
      recipient_confirmed: false,
    })
    .select()
    .single();
  if (error) throw error;
  return parseTradeRow(data);
}

export async function getTrade(id: string): Promise<Trade | null> {
  const { data, error } = await supabase.from('trades').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? parseTradeRow(data) : null;
}

export async function getTradesForUser(userId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .or(`initiator_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(parseTradeRow);
}

export async function saveTrade(trade: Trade): Promise<void> {
  const { error } = await supabase
    .from('trades')
    .update({
      status: trade.status,
      requested_items: trade.requestedItems,
      offered_items: trade.offeredItems,
      initiator_confirmed: trade.initiatorConfirmed,
      recipient_confirmed: trade.recipientConfirmed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trade.id);
  if (error) throw error;
}

export function tradeItemsValue(items: TradeItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

export interface TradeItemView extends TradeItem {
  // false quando a carta não está mais disponível na quantidade negociada (ex: já foi
  // consumida por outra troca concluída enquanto esta ainda estava em andamento) - o
  // item some do cálculo de valor e o pop-up avisa o usuário que ela saiu da negociação.
  available: boolean;
}

// Confere, para cada item de uma troca, se o dono ainda possui a quantidade negociada
// daquela combinação exata de variação/condição/idioma.
export async function computeItemsAvailability(ownerId: string, items: TradeItem[]): Promise<TradeItemView[]> {
  const entriesByCard = new Map<string, VariationEntry[]>();
  const results: TradeItemView[] = [];
  for (const item of items) {
    let entries = entriesByCard.get(item.cardId);
    if (!entries) {
      entries = await getVariationEntries(ownerId, item.cardId);
      entriesByCard.set(item.cardId, entries);
    }
    const match = entries.find(
      (e) => e.variation === item.variation && e.condition === item.condition && (e.language || '') === (item.language || '')
    );
    results.push({ ...item, available: !!match && match.quantity >= item.quantity });
  }
  return results;
}

function totalQuantity(variations: any): number {
  let total = 0;
  for (const conditions of Object.values<any>(variations || {})) {
    for (const details of Object.values<any>(conditions || {})) {
      total += typeof details?.quantity === 'number' ? details.quantity : 0;
    }
  }
  return total;
}

// Grava as variações resultantes de uma carta após a transferência, preservando a flag
// is_for_trade existente enquanto sobrar alguma cópia, e zerando owned/for_trade quando esvaziar
// (mesma regra usada no cliente ao zerar uma carta manualmente).
async function applyCardVariations(userId: string, cardId: string, variations: any): Promise<void> {
  const total = totalQuantity(variations);

  const { data: existing, error: selError } = await supabase
    .from('user_cards')
    .select('is_for_trade')
    .eq('user_id', userId)
    .eq('card_id', cardId)
    .maybeSingle();
  if (selError) throw selError;

  const { error } = await supabase.from('user_cards').upsert({
    user_id: userId,
    card_id: cardId,
    is_owned: total > 0,
    is_for_trade: total > 0 ? existing?.is_for_trade ?? false : false,
    variations,
  });
  if (error) throw error;
}

// Quantidade realmente disponível de uma condição, considerando o idioma específico
// do item (quando informado) ou o agregado legado (quando a condição não tem idiomas).
function availableQuantity(details: any, language?: string): number {
  if (language) return typeof details?.languages?.[language]?.quantity === 'number' ? details.languages[language].quantity : 0;
  if (details?.languages) return 0; // condição com idiomas exige item.language definido
  return typeof details?.quantity === 'number' ? details.quantity : 0;
}

// Remove `amount` unidades de uma condição (de um idioma específico, se informado) e
// retorna o novo objeto da condição, ou undefined se a condição deve ser removida por inteiro.
function debitCondition(details: any, language: string | undefined, amount: number): any {
  if (language) {
    const languages = { ...(details?.languages || {}) };
    const current = languages[language] || { quantity: 0, price: '' };
    const nextQty = (current.quantity || 0) - amount;
    if (nextQty > 0) {
      languages[language] = { ...current, quantity: nextQty };
    } else {
      delete languages[language];
    }
    if (Object.keys(languages).length === 0) return undefined;
    const quantity = Object.values<any>(languages).reduce((sum, l) => sum + (l.quantity || 0), 0);
    return { ...details, quantity, languages };
  }
  const remaining = (details?.quantity || 0) - amount;
  return remaining > 0 ? { ...details, quantity: remaining } : undefined;
}

// Soma `amount` unidades a uma condição (de um idioma específico, se informado),
// preservando o preço do dono original quando o destinatário ainda não tinha a carta.
function creditCondition(details: any, language: string | undefined, amount: number, unitPrice: number): any {
  if (language) {
    const languages = { ...(details?.languages || {}) };
    const current = languages[language] || { quantity: 0, price: '' };
    languages[language] = { quantity: (current.quantity || 0) + amount, price: current.price || String(unitPrice) };
    const quantity = Object.values<any>(languages).reduce((sum, l) => sum + (l.quantity || 0), 0);
    return { quantity, price: '', languages };
  }
  const currentQty = typeof details?.quantity === 'number' ? details.quantity : 0;
  return currentQty > 0 ? { ...details, quantity: currentQty + amount } : { quantity: amount, price: String(unitPrice) };
}

// Move um conjunto de itens (carta/variação/condição/idioma/quantidade) de um usuário
// para outro, preservando a qualidade e o preço do dono original quando o destinatário
// ainda não tinha a carta.
async function transferItems(fromUserId: string, toUserId: string, items: TradeItem[]): Promise<void> {
  for (const item of items) {
    const { data: fromRow, error: fromErr } = await supabase
      .from('user_cards')
      .select('variations')
      .eq('user_id', fromUserId)
      .eq('card_id', item.cardId)
      .maybeSingle();
    if (fromErr) throw fromErr;

    const fromVariations = fromRow?.variations || {};
    const fromDetails = fromVariations?.[item.variation]?.[item.condition];
    const availableQty = availableQuantity(fromDetails, item.language);

    if (availableQty < item.quantity) {
      throw new Error(
        `Quantidade insuficiente de ${item.cardId} (${item.variation}/${item.condition}) para concluir a troca.`
      );
    }

    const nextFromDetails = debitCondition(fromDetails, item.language, item.quantity);
    if (nextFromDetails === undefined) {
      delete fromVariations[item.variation][item.condition];
    } else {
      fromVariations[item.variation][item.condition] = nextFromDetails;
    }
    await applyCardVariations(fromUserId, item.cardId, fromVariations);

    const { data: toRow, error: toErr } = await supabase
      .from('user_cards')
      .select('variations')
      .eq('user_id', toUserId)
      .eq('card_id', item.cardId)
      .maybeSingle();
    if (toErr) throw toErr;

    const toVariations = toRow?.variations || {};
    if (!toVariations[item.variation]) toVariations[item.variation] = {};
    const existingDetails = toVariations[item.variation][item.condition];
    toVariations[item.variation][item.condition] = creditCondition(existingDetails, item.language, item.quantity, item.unitPrice);

    await applyCardVariations(toUserId, item.cardId, toVariations);
  }
}

// Cartas que já não estão mais disponíveis (ex: consumidas por outra troca concluída
// enquanto esta ainda estava em andamento) são retiradas silenciosamente da troca em vez
// de travar a conclusão inteira - o pop-up já avisou o usuário disso antes de ele confirmar.
export async function finalizeTrade(trade: Trade): Promise<void> {
  const requestedAvailability = await computeItemsAvailability(trade.recipientId, trade.requestedItems);
  const offeredAvailability = await computeItemsAvailability(trade.initiatorId, trade.offeredItems);
  trade.requestedItems = requestedAvailability.filter((i) => i.available).map(({ available, ...item }) => item);
  trade.offeredItems = offeredAvailability.filter((i) => i.available).map(({ available, ...item }) => item);

  await transferItems(trade.recipientId, trade.initiatorId, trade.requestedItems);
  if (trade.offeredItems.length > 0) {
    await transferItems(trade.initiatorId, trade.recipientId, trade.offeredItems);
  }
  trade.status = 'completed';
  await saveTrade(trade);
}
