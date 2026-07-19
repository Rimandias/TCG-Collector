import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { env } from '../env.js';
import { asyncHandler } from '../asyncHandler.js';
import { FALLBACK_CARDS, FALLBACK_SETS, generateMockCards, mapSetSeries } from '../fallbackData.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const tcgRouter = Router();

const API_BASE = 'https://api.pokemontcg.io/v2';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

// Limite alto porque a Home carrega as cartas de todas as ~200 coleções do catálogo
// de uma vez (para a busca global) logo no login - e os dados vêm do nosso próprio
// cache (Supabase), não da API externa, então o custo por requisição é baixo.
const tcgLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
});
tcgRouter.use(tcgLimiter);

async function fetchFromPokemonTcg(pathAndQuery: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.pokemonTcgApiKey) {
      headers['X-Api-Key'] = env.pokemonTcgApiKey;
    }
    const response = await fetch(`${API_BASE}${pathAndQuery}`, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Pokemon TCG API respondeu ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapSet(raw: any) {
  const mapped = {
    id: raw.id,
    name: raw.name,
    series: raw.series,
    printedTotal: raw.printedTotal,
    total: raw.total,
    logoUrl: raw.images?.logo || '',
    symbolUrl: raw.images?.symbol || '',
    releaseDate: raw.releaseDate,
    updatedAt: raw.updatedAt,
  };
  mapped.series = mapSetSeries(mapped);
  return mapped;
}

function mapCard(raw: any) {
  return {
    id: raw.id,
    name: raw.name,
    imageUrl: raw.images?.small || '',
    imageUrlHiRes: raw.images?.large || '',
    number: raw.number,
    rarity: raw.rarity || 'Common',
    artist: raw.artist || '',
    isSecret: parseInt(raw.number) > (raw.set?.printedTotal || 0),
    set: {
      id: raw.set?.id,
      name: raw.set?.name,
      printedTotal: raw.set?.printedTotal,
    },
  };
}

tcgRouter.get(
  '/sets',
  asyncHandler(async (_req, res) => {
    const { data: cached } = await supabase.from('sets_cache').select('data, updated_at').eq('id', 'all').maybeSingle();
    const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS;

    if (cached && isFresh) {
      return res.json({ data: cached.data, source: 'cache' });
    }

    try {
      const raw = await fetchFromPokemonTcg('/sets?orderBy=-releaseDate');
      const mapped = (raw?.data || []).map(mapSet);
      await supabase.from('sets_cache').upsert({ id: 'all', data: mapped, updated_at: new Date().toISOString() });
      return res.json({ data: mapped, source: 'live' });
    } catch (err) {
      console.warn('[tcg] Falha ao buscar /sets na Pokemon TCG API, usando contingência:', (err as Error).message);
      if (cached) {
        // Serve cache expirado em vez de fallback genérico
        return res.json({ data: cached.data, source: 'stale-cache' });
      }
      const mapped = FALLBACK_SETS.map((s) => ({ ...s, series: mapSetSeries(s) }));
      return res.json({ data: mapped, source: 'fallback' });
    }
  })
);

const setIdSchema = z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).min(1).max(40);

tcgRouter.get(
  '/cards/:setId',
  asyncHandler(async (req, res) => {
    const parsed = setIdSchema.safeParse(req.params.setId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de coleção inválido.' });
    }
    const setId = parsed.data;

    const { data: cached } = await supabase.from('cards_cache').select('data, updated_at').eq('set_id', setId).maybeSingle();
    const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS;

    if (cached && isFresh) {
      return res.json({ data: cached.data, source: 'cache' });
    }

    try {
      const raw = await fetchFromPokemonTcg(`/cards?q=set.id:${encodeURIComponent(setId)}&orderBy=number`);
      const mapped = (raw?.data || []).map(mapCard);
      await supabase.from('cards_cache').upsert({ set_id: setId, data: mapped, updated_at: new Date().toISOString() });
      return res.json({ data: mapped, source: 'live' });
    } catch (err) {
      console.warn(`[tcg] Falha ao buscar /cards para o set ${setId}, usando contingência:`, (err as Error).message);
      if (cached) {
        return res.json({ data: cached.data, source: 'stale-cache' });
      }
      if (FALLBACK_CARDS[setId]) {
        return res.json({ data: FALLBACK_CARDS[setId], source: 'fallback' });
      }

      let setName = 'Set';
      const { data: setsCached } = await supabase.from('sets_cache').select('data').eq('id', 'all').maybeSingle();
      const sets = setsCached ? setsCached.data : FALLBACK_SETS;
      const matching = (sets as any[]).find((s) => s.id === setId);
      if (matching) setName = matching.name;

      return res.json({ data: generateMockCards(setId, setName), source: 'mock' });
    }
  })
);

const cardIdSchema = z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).min(1).max(60);

interface PriceStat {
  avg: number;
  min: number;
  max: number;
  count: number;
}

tcgRouter.get(
  '/card-stats/:cardId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = cardIdSchema.safeParse(req.params.cardId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de carta inválido.' });
    }
    const cardId = parsed.data;

    const { data: rows, error } = await supabase.from('user_cards').select('variations').eq('card_id', cardId);
    if (error) throw error;

    // variation -> condition -> lista de preços informados por usuários (sem guardar quem)
    const buckets: Record<string, Record<string, number[]>> = {};
    for (const row of rows || []) {
      const variations = row.variations || {};
      for (const [variation, conditions] of Object.entries<any>(variations)) {
        if (!conditions || typeof conditions !== 'object') continue;
        for (const [condition, details] of Object.entries<any>(conditions)) {
          const quantity = typeof details?.quantity === 'number' ? details.quantity : 0;
          const price = parseFloat(details?.price);
          if (quantity <= 0 || !isFinite(price) || price <= 0) continue;
          buckets[variation] ??= {};
          buckets[variation][condition] ??= [];
          buckets[variation][condition].push(price);
        }
      }
    }

    const stats: Record<string, Record<string, PriceStat>> = {};
    for (const [variation, conditions] of Object.entries(buckets)) {
      stats[variation] = {};
      for (const [condition, prices] of Object.entries(conditions)) {
        const sum = prices.reduce((a, b) => a + b, 0);
        stats[variation][condition] = {
          avg: sum / prices.length,
          min: Math.min(...prices),
          max: Math.max(...prices),
          count: prices.length,
        };
      }
    }

    return res.json({ stats });
  })
);
