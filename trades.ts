import { Trade, VisibleFolder } from './types';
import { getAccessToken } from './auth';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const getFriendVisibleFolders = async (friendUserId: string): Promise<VisibleFolder[]> => {
  const response = await fetch(`${API_BASE}/friends/${encodeURIComponent(friendUserId)}/folders`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return [];
  const body = await response.json();
  return body.folders || [];
};

export interface TradeItemSelection {
  cardId: string;
  variation: string;
  condition: string;
  quantity: number;
}

export const createTradeRequest = async (
  recipientId: string,
  folderId: string,
  items: TradeItemSelection[]
): Promise<{ trade?: Trade; error?: string }> => {
  const response = await fetch(`${API_BASE}/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ recipientId, folderId, items }),
  });
  if (!response.ok) {
    return { error: await parseErrorMessage(response, 'Não foi possível iniciar a troca.') };
  }
  const body = await response.json();
  return { trade: body.trade };
};

export const getMyTrades = async (): Promise<Trade[]> => {
  const response = await fetch(`${API_BASE}/trades`, { headers: await authHeaders() });
  if (!response.ok) return [];
  const body = await response.json();
  return body.trades || [];
};

export type TradeAction = 'choose_payment' | 'choose_offer' | 'confirm' | 'cancel';

export const patchTrade = async (
  tradeId: string,
  action: TradeAction
): Promise<{ trade?: Trade; error?: string }> => {
  const response = await fetch(`${API_BASE}/trades/${encodeURIComponent(tradeId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    return { error: await parseErrorMessage(response, 'Não foi possível concluir a ação.') };
  }
  const body = await response.json();
  return { trade: body.trade };
};

export const submitTradeOffer = async (
  tradeId: string,
  items: TradeItemSelection[]
): Promise<{ trade?: Trade; error?: string }> => {
  const response = await fetch(`${API_BASE}/trades/${encodeURIComponent(tradeId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ action: 'submit_offer', items }),
  });
  if (!response.ok) {
    return { error: await parseErrorMessage(response, 'Não foi possível enviar a oferta.') };
  }
  const body = await response.json();
  return { trade: body.trade };
};
