import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { asyncHandler } from '../asyncHandler.js';
import { FALLBACK_CARDS, FALLBACK_SETS, generateMockCards, mapSetSeries } from '../fallbackData.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const tcgRouter = Router();

const TCGDEX_BASE = 'https://api.tcgdex.net/v2';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

// `serie.id` é estável entre locales - `serie.name` não é (ex: "Pokémon TCG Pocket" em
// `en` vira "Pokémon Estampas Ilustradas Pocket" em `pt`, e como a maioria dos sets busca
// o detalhe em `pt` primeiro, filtrar pelo nome em inglês deixava passar o Pocket batido).
// 'tcgp' é o joguinho de celular (Pokémon TCG Pocket), não o TCG físico - fora do escopo.
// 'sp' ("Sample") é um set de teste/placeholder da própria TCGdex, sem cartas reais.
const EXCLUDED_SERIE_IDS = new Set(['tcgp']);
const EXCLUDED_SET_IDS = new Set(['sp']);

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

async function fetchTcgdex(locale: string, path: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TCGDEX_BASE}/${locale}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`TCGdex respondeu ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Roda até `limit` requisições em paralelo por vez, ao invés de todas de uma vez - a
// listagem em lote da TCGdex não traz série/data de lançamento, então cada uma das ~200
// coleções precisa de uma chamada própria de detalhe (mesmo padrão usado em tcgJp.ts).
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

// Era canônica por `serie.id` da TCGdex (estável entre locales, ao contrário de
// `serie.name`). Levantado comparando o catálogo completo da TCGdex com o da
// pokemontcg.io (cujo campo `series` já vinha nesses nomes em inglês, que o app usa
// desde sempre pra agrupar Home/Coleções por era).
const SERIE_ID_TO_ERA: Record<string, string> = {
  base: 'Base',
  gym: 'Gym',
  neo: 'Neo',
  ecard: 'E-Card',
  ex: 'EX',
  dp: 'Diamond & Pearl',
  pl: 'Platinum',
  hgss: 'HeartGold & SoulSilver',
  bw: 'Black & White',
  xy: 'XY',
  sm: 'Sun & Moon',
  swsh: 'Sword & Shield',
  sv: 'Scarlet & Violet',
  me: 'Mega Evolution',
  pop: 'POP',
};

// "McDonald's Collection", "Trainer kits", "Legendary Collection", "Call of Legends" e
// "Miscellaneous" são séries próprias na TCGdex, mas na pokemontcg.io (referência que o
// app sempre usou) essas coleções ficam dentro da era em que foram lançadas - decompõe
// por id/data pra manter a mesma agrupação de eras que a Home já tinha antes da migração.
// Usa o id do set (não o nome) porque o nome já vem traduzido nesse ponto do código.
const FLAT_SERIE_IDS = new Set(['mc', 'tk', 'lc', 'col', 'misc']);
const SET_ID_ERA_OVERRIDE: Record<string, string> = {
  lc: 'E-Card', // Legendary Collection
  col1: 'HeartGold & SoulSilver', // Call of Legends
};

function eraByReleaseYear(releaseDate: string): string {
  const year = parseInt((releaseDate || '').split('-')[0], 10);
  if (!year) return 'Promos / Outras';
  if (year <= 2002) return 'Base';
  if (year <= 2006) return 'EX';
  if (year <= 2008) return 'Diamond & Pearl';
  if (year <= 2010) return 'HeartGold & SoulSilver';
  if (year <= 2013) return 'Black & White';
  if (year <= 2016) return 'XY';
  if (year <= 2019) return 'Sun & Moon';
  if (year <= 2022) return 'Sword & Shield';
  return 'Scarlet & Violet';
}

function mapTcgdexEra(raw: any): string {
  const serieId = raw.serie?.id;
  if (!serieId || FLAT_SERIE_IDS.has(serieId)) {
    if (SET_ID_ERA_OVERRIDE[raw.id]) return SET_ID_ERA_OVERRIDE[raw.id];
    return eraByReleaseYear(raw.releaseDate);
  }
  return SERIE_ID_TO_ERA[serieId] || raw.serie?.name || 'Outras';
}

function mapSet(raw: any) {
  return {
    id: raw.id,
    name: raw.name,
    series: mapTcgdexEra(raw),
    printedTotal: raw.cardCount?.official || 0,
    total: raw.cardCount?.total || raw.cardCount?.official || 0,
    logoUrl: raw.logo ? `${raw.logo}.webp` : '',
    symbolUrl: raw.symbol ? `${raw.symbol}.webp` : '',
    releaseDate: raw.releaseDate || '',
    updatedAt: raw.releaseDate || '',
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
      // A listagem em `en` é a mais completa: dezenas de coleções reais (Base Set 2, Team
      // Rocket, Neo Genesis, Gym Heroes...) simplesmente não existem em `pt` (404 no detalhe,
      // não só cartas vazias) - usá-la como base evita perder essas coleções inteiras. O
      // nome/logo em português (quando existe) ainda vem do detalhe por coleção abaixo.
      const list = await fetchTcgdex('en', '/sets');
      const filtered = (list || []).filter((s: any) => !EXCLUDED_SET_IDS.has(s.id));
      const details = await mapConcurrent(filtered, 15, async (s: any) => {
        try {
          return await fetchTcgdex('pt', `/sets/${s.id}`);
        } catch {
          try {
            return await fetchTcgdex('en', `/sets/${s.id}`);
          } catch {
            return null;
          }
        }
      });
      const mapped = details
        .filter(Boolean)
        .filter((raw: any) => !EXCLUDED_SERIE_IDS.has(raw.serie?.id))
        .map(mapSet);
      await supabase.from('sets_cache').upsert({ id: 'all', data: mapped, updated_at: new Date().toISOString() });
      return res.json({ data: mapped, source: 'live' });
    } catch (err) {
      console.warn('[tcg] Falha ao buscar /sets na TCGdex, usando contingência:', (err as Error).message);
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
      let setDetail: any;
      let source = 'live';
      try {
        setDetail = await fetchTcgdex('pt', `/sets/${setId}`);
        // Coleções muito antigas (Base Set até HeartGold/SoulSilver) ainda não têm cartas
        // traduzidas na TCGdex - o set em si já vem com nome em português, mas a lista de
        // cartas vem vazia. Só nesse caso cai pro inglês; o id/número da carta é o mesmo
        // dos dois lados, então nada mais no app é afetado por essa troca de idioma.
        if (!setDetail?.cards || setDetail.cards.length === 0) {
          setDetail = await fetchTcgdex('en', `/sets/${setId}`);
          source = 'live-en-fallback';
        }
      } catch {
        // Dezenas de coleções (Base Set 2, Team Rocket, Neo Genesis...) nem existem em
        // `pt` (404 direto, não só cartas vazias) - cai pro inglês inteiro nesse caso.
        setDetail = await fetchTcgdex('en', `/sets/${setId}`);
        source = 'live-en-fallback';
      }
      const printedTotal = setDetail.cardCount?.official || 0;
      // Raridade e ilustrador só vêm no endpoint de carta individual, não nessa listagem
      // em lote - ficam vazios aqui (mesma limitação que o catálogo japonês já tinha) e são
      // preenchidos sob demanda quando o usuário abre a carta (ver /card-variants/:cardId).
      // Buscar isso pra todo o catálogo aqui multiplicaria uma chamada por coleção em
      // centenas por coleção, o que é exatamente o problema de lentidão que a busca global
      // já corrigiu uma vez (ver comentário do limitador de taxa acima).
      const mapped = (setDetail.cards || []).map((c: any) => ({
        id: c.id,
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
      return res.json({ data: mapped, source });
    } catch (err) {
      console.warn(`[tcg] Falha ao buscar /cards para o set ${setId}, usando contingência:`, (err as Error).message);
      if (cached) {
        return res.json({ data: cached.data, source: 'stale-cache' });
      }
      if (FALLBACK_CARDS[setId]) {
        return res.json({ data: FALLBACK_CARDS[setId], source: 'fallback' });
      }

      let setName = 'Set';
      let setTotal: number | undefined;
      const { data: setsCached } = await supabase.from('sets_cache').select('data').eq('id', 'all').maybeSingle();
      const sets = setsCached ? setsCached.data : FALLBACK_SETS;
      const matching = (sets as any[]).find((s) => s.id === setId);
      if (matching) {
        setName = matching.name;
        setTotal = matching.total;
      }

      return res.json({ data: generateMockCards(setId, setName, setTotal), source: 'mock' });
    }
  })
);

const searchQuerySchema = z.string().trim().min(1).max(60);

// Busca cartas em TODAS as coleções já cacheadas, direto no Postgres (função search_cards),
// em vez de o cliente baixar o catálogo inteiro (~200 coleções, ~20 mil cartas) para filtrar
// localmente — isso levava quase 20s antes de a busca sequer funcionar.
tcgRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query.q);
    if (!parsed.success) {
      return res.json({ data: [] });
    }
    const { data, error } = await supabase.rpc('search_cards', { search_query: parsed.data, result_limit: 150 });
    if (error) {
      console.warn('[tcg] Falha na busca de cartas:', error.message);
      return res.json({ data: [] });
    }
    return res.json({ data: data || [] });
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
          const languages = details?.languages;
          if (languages && typeof languages === 'object' && Object.keys(languages).length > 0) {
            // Preço médio da comunidade não distingue idioma/nacionalidade da carta -
            // cada idioma informado entra na mesma estatística de variação/condição.
            for (const lang of Object.values<any>(languages)) {
              const quantity = typeof lang?.quantity === 'number' ? lang.quantity : 0;
              const price = parseFloat(lang?.price);
              if (quantity <= 0 || !isFinite(price) || price <= 0) continue;
              buckets[variation] ??= {};
              buckets[variation][condition] ??= [];
              buckets[variation][condition].push(price);
            }
            continue;
          }
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

// Bandeiras de variação (Standard/Foil/Reverse Foil/First Edition/Pokeball/Master Ball) que
// realmente existem pra uma carta específica, vindas do endpoint de detalhe da TCGdex (só
// esse traz `variants`/`variants_detailed`, a listagem em lote não traz). Usado pelo
// CardModal pra esconder variações que a carta nunca teve, sem nunca esconder uma que já
// tenha quantidade/preço registrados pelo usuário (isso é decidido no frontend).
const CACHE_VARIANTS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias - dado histórico, não muda

function extractVariantFlags(detail: any): { flags: Record<string, boolean>; rarity: string; artist: string } {
  const v = detail?.variants || {};
  const flags: Record<string, boolean> = {
    Standard: !!v.normal,
    Foil: !!v.holo,
    'Reverse Foil': !!v.reverse,
    'First Edition': !!v.firstEdition,
  };

  const detailed: any[] = Array.isArray(detail?.variants_detailed) ? detail.variants_detailed : [];
  let pokeball = false;
  let masterBall = false;
  for (const entry of detailed) {
    const foilName = (entry?.foil || '').toLowerCase();
    if (!foilName) continue;
    if (foilName.includes('poke') || foilName.includes('poké')) pokeball = true;
    if (foilName.includes('master')) masterBall = true;
  }
  flags['Pokeball'] = pokeball;
  flags['Master Ball'] = masterBall;

  return { flags, rarity: detail?.rarity || '', artist: detail?.illustrator || '' };
}

tcgRouter.get(
  '/card-variants/:cardId',
  asyncHandler(async (req, res) => {
    const parsed = cardIdSchema.safeParse(req.params.cardId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de carta inválido.' });
    }
    const cardId = parsed.data;

    const { data: cached } = await supabase.from('card_variants_cache').select('data, updated_at').eq('card_id', cardId).maybeSingle();
    const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_VARIANTS_TTL_MS;
    if (cached && isFresh) {
      return res.json(cached.data);
    }

    try {
      let detail: any;
      try {
        detail = await fetchTcgdex('pt', `/cards/${cardId}`);
        if (!detail || Object.keys(detail).length === 0) {
          detail = await fetchTcgdex('en', `/cards/${cardId}`);
        }
      } catch {
        // Cartas de coleções sem `pt` (ver /sets acima) 404 direto no detalhe também.
        detail = await fetchTcgdex('en', `/cards/${cardId}`);
      }
      const result = extractVariantFlags(detail);
      await supabase.from('card_variants_cache').upsert({ card_id: cardId, data: result, updated_at: new Date().toISOString() });
      return res.json(result);
    } catch (err) {
      console.warn(`[tcg] Falha ao buscar variantes da carta ${cardId}:`, (err as Error).message);
      if (cached) {
        return res.json(cached.data);
      }
      // Sem dado nenhum: devolve flags vazias - o frontend trata "sem dado" como "mostra tudo".
      return res.json({ flags: {}, rarity: '', artist: '' });
    }
  })
);
