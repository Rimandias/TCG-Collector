import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';
import { FALLBACK_CARDS, FALLBACK_SETS, generateMockCards, mapSetSeries } from '../fallbackData.js';

export const tcgRouter = Router();

const API_BASE = 'https://api.pokemontcg.io/v2';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

const tcgLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
tcgRouter.use(tcgLimiter);

const getSetsCache = db.prepare(`SELECT data, updated_at FROM sets_cache WHERE id = 'all'`);
const upsertSetsCache = db.prepare(`
  INSERT INTO sets_cache (id, data, updated_at) VALUES ('all', ?, ?)
  ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
const getCardsCache = db.prepare(`SELECT data, updated_at FROM cards_cache WHERE set_id = ?`);
const upsertCardsCache = db.prepare(`
  INSERT INTO cards_cache (set_id, data, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(set_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);

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
    isSecret: parseInt(raw.number) > (raw.set?.printedTotal || 0),
    marketPrice: raw.tcgplayer?.prices?.holofoil?.market || raw.tcgplayer?.prices?.normal?.market || 0,
    set: {
      id: raw.set?.id,
      name: raw.set?.name,
      printedTotal: raw.set?.printedTotal,
    },
  };
}

tcgRouter.get('/sets', async (_req, res) => {
  const cached = getSetsCache.get() as { data: string; updated_at: number } | undefined;
  const isFresh = cached && Date.now() - cached.updated_at < CACHE_TTL_MS;

  if (cached && isFresh) {
    return res.json({ data: JSON.parse(cached.data), source: 'cache' });
  }

  try {
    const raw = await fetchFromPokemonTcg('/sets?orderBy=-releaseDate');
    const mapped = (raw?.data || []).map(mapSet);
    upsertSetsCache.run(JSON.stringify(mapped), Date.now());
    return res.json({ data: mapped, source: 'live' });
  } catch (err) {
    console.warn('[tcg] Falha ao buscar /sets na Pokemon TCG API, usando contingência:', (err as Error).message);
    if (cached) {
      // Serve cache expirado em vez de fallback genérico
      return res.json({ data: JSON.parse(cached.data), source: 'stale-cache' });
    }
    const mapped = FALLBACK_SETS.map((s) => ({ ...s, series: mapSetSeries(s) }));
    return res.json({ data: mapped, source: 'fallback' });
  }
});

const setIdSchema = z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).min(1).max(40);

tcgRouter.get('/cards/:setId', async (req, res) => {
  const parsed = setIdSchema.safeParse(req.params.setId);
  if (!parsed.success) {
    return res.status(400).json({ error: 'ID de coleção inválido.' });
  }
  const setId = parsed.data;

  const cached = getCardsCache.get(setId) as { data: string; updated_at: number } | undefined;
  const isFresh = cached && Date.now() - cached.updated_at < CACHE_TTL_MS;

  if (cached && isFresh) {
    return res.json({ data: JSON.parse(cached.data), source: 'cache' });
  }

  try {
    const raw = await fetchFromPokemonTcg(`/cards?q=set.id:${encodeURIComponent(setId)}&orderBy=number`);
    const mapped = (raw?.data || []).map(mapCard);
    upsertCardsCache.run(setId, JSON.stringify(mapped), Date.now());
    return res.json({ data: mapped, source: 'live' });
  } catch (err) {
    console.warn(`[tcg] Falha ao buscar /cards para o set ${setId}, usando contingência:`, (err as Error).message);
    if (cached) {
      return res.json({ data: JSON.parse(cached.data), source: 'stale-cache' });
    }
    if (FALLBACK_CARDS[setId]) {
      return res.json({ data: FALLBACK_CARDS[setId], source: 'fallback' });
    }

    let setName = 'Set';
    const setsCached = getSetsCache.get() as { data: string } | undefined;
    const sets = setsCached ? JSON.parse(setsCached.data) : FALLBACK_SETS;
    const matching = sets.find((s: any) => s.id === setId);
    if (matching) setName = matching.name;

    return res.json({ data: generateMockCards(setId, setName), source: 'mock' });
  }
});
