import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { asyncHandler } from '../asyncHandler.js';

// Catálogo de coleções japonesas (exclusivas do Japão) via TCGdex - a Pokemon TCG API
// (pokemontcg.io, usada pelo resto do app) só cobre lançamentos ocidentais/em inglês
// (ver https://github.com/PokemonTCG/pokemon-tcg-api/issues/78, aberta desde 2018 e
// nunca implementada). TCGdex é gratuita, sem chave de API, e tem um catálogo japonês
// completo e separado (https://tcgdex.dev/).
export const tcgJpRouter = Router();

const TCGDEX_BASE = 'https://api.tcgdex.net/v2/ja';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const ID_PREFIX = 'jp-';
const ALL_SETS_CACHE_ID = 'jp-all';

const tcgJpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
});
tcgJpRouter.use(tcgJpLimiter);

async function fetchTcgdex(path: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TCGDEX_BASE}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`TCGdex respondeu ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Roda até `limit` requisições em paralelo por vez, ao invés de todas de uma vez
// (o catálogo japonês tem ~180 coleções e cada uma precisa de uma chamada própria
// pra obter série/data de lançamento, que não vêm na listagem em lote da TCGdex).
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mapSet(raw: any) {
  const seriesId = raw.serie?.id || '';
  const assetBase = seriesId ? `https://assets.tcgdex.net/ja/${seriesId}/${raw.id}` : '';
  return {
    id: `${ID_PREFIX}${raw.id}`,
    name: raw.name,
    series: raw.serie?.name || 'Outras',
    printedTotal: raw.cardCount?.official || 0,
    total: raw.cardCount?.total || raw.cardCount?.official || 0,
    logoUrl: assetBase ? `${assetBase}/logo.webp` : '',
    symbolUrl: assetBase ? `${assetBase}/symbol.webp` : '',
    releaseDate: raw.releaseDate || '',
    updatedAt: raw.releaseDate || '',
  };
}

tcgJpRouter.get(
  '/sets',
  asyncHandler(async (_req, res) => {
    const { data: cached } = await supabase.from('sets_cache').select('data, updated_at').eq('id', ALL_SETS_CACHE_ID).maybeSingle();
    const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS;

    if (cached && isFresh) {
      return res.json({ data: cached.data, source: 'cache' });
    }

    try {
      const list = await fetchTcgdex('/sets');
      const details = await mapConcurrent(list, 15, async (s: any) => {
        try {
          return await fetchTcgdex(`/sets/${s.id}`);
        } catch {
          return null;
        }
      });
      const mapped = details.filter(Boolean).map(mapSet);
      await supabase.from('sets_cache').upsert({ id: ALL_SETS_CACHE_ID, data: mapped, updated_at: new Date().toISOString() });
      return res.json({ data: mapped, source: 'live' });
    } catch (err) {
      console.warn('[tcg-jp] Falha ao buscar /sets na TCGdex, usando cache:', (err as Error).message);
      if (cached) {
        return res.json({ data: cached.data, source: 'stale-cache' });
      }
      return res.json({ data: [], source: 'fallback' });
    }
  })
);

const setIdSchema = z.string().trim().regex(/^jp-[a-zA-Z0-9.-]+$/).min(4).max(60);

tcgJpRouter.get(
  '/cards/:setId',
  asyncHandler(async (req, res) => {
    const parsed = setIdSchema.safeParse(req.params.setId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de coleção inválido.' });
    }
    const setId = parsed.data;
    const realId = setId.slice(ID_PREFIX.length);

    const { data: cached } = await supabase.from('cards_cache').select('data, updated_at').eq('set_id', setId).maybeSingle();
    const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS;

    if (cached && isFresh) {
      return res.json({ data: cached.data, source: 'cache' });
    }

    try {
      const setDetail = await fetchTcgdex(`/sets/${realId}`);
      const printedTotal = setDetail.cardCount?.official || 0;
      const mapped = (setDetail.cards || []).map((c: any) => ({
        id: `${ID_PREFIX}${c.id}`,
        name: c.name,
        imageUrl: c.image ? `${c.image}/low.webp` : '',
        imageUrlHiRes: c.image ? `${c.image}/high.webp` : '',
        number: c.localId,
        rarity: '',
        artist: '',
        isSecret: parseInt(c.localId, 10) > printedTotal,
        set: { id: setId, name: setDetail.name, printedTotal },
      }));
      await supabase.from('cards_cache').upsert({ set_id: setId, data: mapped, updated_at: new Date().toISOString() });
      return res.json({ data: mapped, source: 'live' });
    } catch (err) {
      console.warn(`[tcg-jp] Falha ao buscar cartas de ${setId} na TCGdex:`, (err as Error).message);
      if (cached) {
        return res.json({ data: cached.data, source: 'stale-cache' });
      }
      return res.json({ data: [], source: 'fallback' });
    }
  })
);
