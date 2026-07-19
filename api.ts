// Cliente do catálogo de cartas (séries/coleções). Toda a lógica de acesso à Pokemon TCG API
// (incluindo a chave de API e os dados de contingência) vive agora no backend — este arquivo
// só fala com o nosso próprio servidor, nunca diretamente com serviços externos.

import { getAccessToken } from './auth';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

const fetchWithTimeout = async (url: string, timeout = 8000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(id);
  }
};

// Views diferentes (Home, Coleções, Trocas) montam ao mesmo tempo e cada uma pede o catálogo
// completo (todos os sets/cartas) para suas próprias listas. Sem essa deduplicação, trocar de
// aba disparava dezenas/centenas de requisições concorrentes repetidas para a mesma URL,
// congestionando a fila de conexões do navegador e deixando toda a UI lenta.
// Guarda o corpo já parseado (não o Response cru): o corpo de um Response só pode ser lido
// uma vez, então se dois chamadores compartilhassem o mesmo Response e ambos chamassem
// .json(), o segundo falharia com "body stream already read".
const inFlightRequests = new Map<string, Promise<any>>();

const fetchDeduped = (url: string, timeout: number): Promise<any> => {
  const existing = inFlightRequests.get(url);
  if (existing) return existing;
  const request = fetchWithTimeout(url, timeout)
    .then((res) => res.json())
    .finally(() => {
      inFlightRequests.delete(url);
    });
  inFlightRequests.set(url, request);
  return request;
};

// Além de deduplicar chamadas simultâneas, evita reagendar uma revalidação em segundo plano
// para a mesma URL se ela já rodou recentemente (ex.: usuário trocando de aba repetidamente).
const lastBackgroundSyncAt = new Map<string, number>();
const BACKGROUND_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

const shouldRunBackgroundSync = (url: string): boolean => {
  const last = lastBackgroundSyncAt.get(url);
  if (last && Date.now() - last < BACKGROUND_SYNC_COOLDOWN_MS) return false;
  lastBackgroundSyncAt.set(url, Date.now());
  return true;
};

// FETCH SETS WITH CLIENT-SIDE SWR CACHING (o backend já cacheia/faz fallback do lado dele)
export const fetchSets = async () => {
  const CACHE_KEY = 'poketracker_cache_sets';

  let cachedData: any[] | null = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) cachedData = JSON.parse(item);
  } catch (e) {
    console.warn('Could not read sets cache:', e);
  }

  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    // Revalida em segundo plano, sem bloquear a UI. Timeout generoso (20s) porque
    // é comum haver dezenas dessas chamadas concorrentes logo no login. Deduplicada e
    // limitada por cooldown para não repetir a cada troca de aba (Home/Coleções/Trocas).
    const url = `${API_BASE}/tcg/sets`;
    if (shouldRunBackgroundSync(url)) {
      fetchDeduped(url, 20000)
        .then((body) => {
          if (body?.data) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
          }
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') console.warn('Background sets sync skipped/failed:', err.message);
        });
    }

    return cachedData;
  }

  try {
    const body = await fetchDeduped(`${API_BASE}/tcg/sets`, 8000);
    if (!body?.data) throw new Error('Invalid data format received from backend');

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
    } catch (e) {
      console.warn('Could not write sets cache:', e);
    }

    return body.data;
  } catch (error) {
    console.error('Error fetching sets from backend:', error);
    return [];
  }
};

// FETCH CARDS WITH CLIENT-SIDE SWR CACHING
export const fetchCardsBySet = async (setId: string, skipBackgroundSync = false) => {
  const CACHE_KEY = `poketracker_cache_cards_${setId}`;

  let cachedData: any[] | null = null;
  try {
    const item = localStorage.getItem(CACHE_KEY);
    if (item) cachedData = JSON.parse(item);
  } catch (e) {
    console.warn('Could not read cards cache:', e);
  }

  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    const url = `${API_BASE}/tcg/cards/${encodeURIComponent(setId)}`;
    if (!skipBackgroundSync && shouldRunBackgroundSync(url)) {
      fetchDeduped(url, 20000)
        .then((body) => {
          if (body?.data) {
            localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
          }
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') console.warn(`Background cards sync for ${setId} skipped/failed:`, err.message);
        });
    }

    return cachedData;
  }

  try {
    const body = await fetchDeduped(`${API_BASE}/tcg/cards/${encodeURIComponent(setId)}`, 8000);
    if (!body?.data) throw new Error('Invalid data format received from backend');

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(body.data));
    } catch (e) {
      console.warn('Could not write cards cache:', e);
    }

    return body.data;
  } catch (error: any) {
    console.warn(`Error fetching cards for set ${setId}: ${error?.message || error}.`);
    return [];
  }
};

export interface CardPriceStat {
  avg: number;
  min: number;
  max: number;
  count: number;
}

// variação -> condição -> estatística de preço agregada entre todos os usuários que informaram um preço.
export type CardPriceStats = Record<string, Record<string, CardPriceStat>>;

// Estatísticas comunitárias de preço (média/mínimo/máximo) para uma carta específica,
// calculadas no backend a partir dos preços que os próprios usuários informaram.
export const fetchCardStats = async (cardId: string): Promise<CardPriceStats> => {
  const token = await getAccessToken();
  if (!token) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}/tcg/card-stats/${encodeURIComponent(cardId)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return {};
    const body = await response.json();
    return body?.stats || {};
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      console.warn(`Could not load price stats for ${cardId}:`, (err as Error).message);
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
};
