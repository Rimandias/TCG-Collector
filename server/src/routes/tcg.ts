import { Router, type Request, type Response, type NextFunction } from 'express';
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

// Algumas coleções (ex: "Astros Cintilantes Galeria de Treinador", "MEP Black Star
// Promos", McDonald's) não têm logo/símbolo próprio em NENHUM locale da TCGdex - são
// sub-coleções/promos sem asset visual dedicado. Pra essas, pega emprestado o logo/
// símbolo da coleção-mãe (quando o usuário indicou uma) ou da coleção-carro-chefe da
// mesma era (quando não há uma coleção-mãe óbvia), em vez de deixar o card sem imagem.
const FALLBACK_LOGO_SET_ID: Record<string, string> = {
  mee: 'me01', // Megaevolução Energia -> Megaevolução
  mep: 'me01', // MEP Black Star Promos -> Megaevolução
  sve: 'sv01', // Escarlate e Violeta Energia -> Escarlate e Violeta
  svp: 'sv01', // SVP Black Star Promos -> Escarlate e Violeta
  '2023sv': 'sv01', // McDonald's Collection 2023 -> Escarlate e Violeta
  mfb: 'sv01', // My First Battle -> Escarlate e Violeta
  sv08: 'sv01', // Fagulhas Impetuosas (símbolo ausente nos dois locales) -> Escarlate e Violeta
  'sv08.5': 'sv01', // Evoluções Prismáticas (símbolo ausente nos dois locales) -> Escarlate e Violeta
  '2022swsh': 'swsh1', // McDonald's Collection 2022 -> Espada e Escudo
  '2021swsh': 'swsh1', // McDonald's Collection 2021 -> Espada e Escudo
  'swsh4.5sv': 'swsh4.5', // Destinos Brilhantes Cofre Brilhante -> Destinos Brilhantes
  cel25cc: 'cel25', // Celebrações Coleção Clássica -> Celebrações
  'swsh9.5tg': 'swsh9', // Astros Cintilantes Galeria de Treinador -> Astros Cintilantes
  'swsh10.5tg': 'swsh10', // Estrelas Radiantes Galeria de Treinador -> Estrelas Radiantes
  'swsh11.5tg': 'swsh11', // Origem Perdida Galeria de Treinador -> Origem Perdida
  'swsh12.5tg': 'swsh12', // Tempestade Prateada Galeria de Treinador -> Tempestade Prateada
  'swsh12.5gg': 'swsh12.5', // Realeza Absoluta Galeria de Galar -> Realeza Absoluta
  me02: 'me01', // Fogo Fantasmagórico (símbolo ausente nos dois locales) -> Megaevolução
  bog: 'ecard1', // Best of game (logo ausente nos dois locales) -> Expedition Base Set

  // Mesmo padrão acima, pro restante do catálogo com a mesma lacuna (McDonald's de anos
  // sem cobertura, Trainer Kits e sub-coleções avulsas sem asset visual próprio na TCGdex).
  '2011bw': 'bw1', '2012bw': 'bw1',
  '2014xy': 'xy1', '2015xy': 'xy1', '2016xy': 'xy1',
  '2017sm': 'sm1', '2018sm': 'sm1', '2019sm': 'sm1',
  '2024sv': 'sv01',
  miscp: 'base1', wp: 'base1', jumbo: 'base1',
  'tk-ex-latia': 'ex1', 'tk-ex-latio': 'ex1', 'tk-ex-m': 'ex1', 'tk-ex-p': 'ex1',
  'tk-dp-l': 'dp1', 'tk-dp-m': 'dp1',
  'tk-hs-r': 'hgss1', 'tk-hs-g': 'hgss1',
  'tk-bw-z': 'bw1', 'tk-bw-e': 'bw1',
  'tk-xy-sy': 'xy1', 'tk-xy-n': 'xy1', 'tk-xy-b': 'xy1', 'tk-xy-w': 'xy1',
  'tk-xy-latia': 'xy1', 'tk-xy-latio': 'xy1', 'tk-xy-su': 'xy1', 'tk-xy-p': 'xy1',
  'tk-sm-r': 'sm1', 'tk-sm-l': 'sm1',
  'ex5.5': 'ex1', // Poké Card Creator Pack
  exu: 'ex10', // Unseen Forces Unown Collection -> Unseen Forces (mesmo dia de lançamento)
  rc: 'bw11', // Radiant Collection -> Tesouros Lendários (mesmo dia de lançamento)
  xya: 'xy1', // Yellow A Alternate
  'sm3.5': 'sm3', // Lendas Luminescentes -> Sombras Ardentes (mesma era, lançamento próximo)
  'sm7.5': 'sm7', // Dragões Soberanos -> Tempestade Celestial (mesma era, lançamento próximo)
  sma: 'sm115', // Destinos Ocultos Cofre Brilhante -> Destinos Ocultos (mesmo dia de lançamento)
  sv07: 'sv01', // Coroa Estelar (símbolo ausente nos dois locales)
};

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
    // Código curto (ex: "TEF") usado em listas de deck copiadas de outros lugares (Limitless,
    // PTCGO/PTCGL) - vem de `abbreviation.official` na TCGdex quando existe. Ausente em sets
    // sem código "oficial" (promos, etc) - `null` nesse caso, tratado como "sem match" em
    // /resolve-decklist.
    code: raw.abbreviation?.official || null,
  };
}

// Catálogo (sets/cards) muda muito pouco e é igual pra todo mundo - marcar como cacheável
// deixa o navegador (e qualquer CDN na frente) reaproveitar a resposta sem nem chegar no
// Render de novo dentro da mesma janela do nosso próprio cache em Supabase, cortando tráfego
// de saída em requisições repetidas (ex: usuário reabrindo o app, várias abas).
const catalogCacheControl = (_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
  next();
};

tcgRouter.get(
  '/sets',
  catalogCacheControl,
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
        let detail: any;
        try {
          detail = await fetchTcgdex('pt', `/sets/${s.id}`);
        } catch {
          try {
            return await fetchTcgdex('en', `/sets/${s.id}`);
          } catch {
            return null;
          }
        }
        // O locale `pt` traduz nome/cartas de muita coisa, mas o asset de logo em si só
        // existe em `pt` pra coleções bem recentes - eras inteiras (Sun & Moon, XY, Black
        // & White, HeartGold & SoulSilver...) têm cartas traduzidas mas nenhum logo/símbolo
        // em `pt`, só em `en`. Busca o detalhe em inglês só quando falta algo visual.
        if (!detail.logo || !detail.symbol) {
          try {
            const enDetail = await fetchTcgdex('en', `/sets/${s.id}`);
            detail.logo = detail.logo || enDetail.logo;
            detail.symbol = detail.symbol || enDetail.symbol;
          } catch {
            // Sem logo/símbolo em nenhum dos dois locales - resolvido pelo fallback
            // entre coleções relacionadas logo abaixo (FALLBACK_LOGO_SET_ID).
          }
        }
        return detail;
      });
      const mapped = details
        .filter(Boolean)
        .filter((raw: any) => !EXCLUDED_SERIE_IDS.has(raw.serie?.id))
        .map(mapSet);

      const byId = new Map(mapped.map((s: any) => [s.id, s]));
      for (const [setId, fallbackId] of Object.entries(FALLBACK_LOGO_SET_ID)) {
        const set = byId.get(setId);
        const fallbackSet = byId.get(fallbackId);
        if (!set || !fallbackSet) continue;
        if (!set.logoUrl) set.logoUrl = fallbackSet.logoUrl;
        if (!set.symbolUrl) set.symbolUrl = fallbackSet.symbolUrl;
      }

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

// Extraído do handler de /cards/:setId (mesma lógica de cache/fallback) para ser
// reutilizado por /resolve-decklist, que precisa das cartas de vários sets sem
// depender de uma resposta HTTP - evita duplicar a lógica de cache/locale/fallback.
async function fetchAndCacheSetCards(setId: string): Promise<{ data: any[]; source: string }> {
  const { data: cached } = await supabase.from('cards_cache').select('data, updated_at').eq('set_id', setId).maybeSingle();
  const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_TTL_MS;

  if (cached && isFresh) {
    return { data: cached.data, source: 'cache' };
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
        } else {
          // Promos em andamento (ex: SVP) recebem cartas novas com frequência e a tradução
          // pt às vezes fica pra trás por algumas cartas específicas (não o set inteiro vazio,
          // caso já tratado acima) - detectado comparando com `en`, que serve de teto: qualquer
          // localId presente lá mas ausente em pt é preenchido a partir do en (mantém pt pro
          // resto, já que o nome traduzido é preferível quando existe).
          const enDetail = await fetchTcgdex('en', `/sets/${setId}`).catch(() => null);
          if (enDetail?.cards?.length > setDetail.cards.length) {
            const ptIds = new Set(setDetail.cards.map((c: any) => c.localId));
            const missingFromPt = enDetail.cards.filter((c: any) => !ptIds.has(c.localId));
            if (missingFromPt.length > 0) {
              setDetail = { ...setDetail, cards: [...setDetail.cards, ...missingFromPt] };
              source = 'live-pt-en-merged';
            }
          }
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
    return { data: mapped, source };
  } catch (err) {
    console.warn(`[tcg] Falha ao buscar /cards para o set ${setId}, usando contingência:`, (err as Error).message);
    if (cached) {
      return { data: cached.data, source: 'stale-cache' };
    }
    if (FALLBACK_CARDS[setId]) {
      return { data: FALLBACK_CARDS[setId], source: 'fallback' };
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

    return { data: generateMockCards(setId, setName, setTotal), source: 'mock' };
  }
}

tcgRouter.get(
  '/cards/:setId',
  catalogCacheControl,
  asyncHandler(async (req, res) => {
    const parsed = setIdSchema.safeParse(req.params.setId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de coleção inválido.' });
    }
    const result = await fetchAndCacheSetCards(parsed.data);
    return res.json(result);
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

// Bandeiras de variação que realmente existem pra uma carta específica, vindas do endpoint de
// detalhe da TCGdex (só esse traz `variants`/`variants_detailed`, a listagem em lote não traz).
// Usado pelo CardModal pra esconder variações que a carta nunca teve, sem nunca esconder uma
// que já tenha quantidade/preço registrados pelo usuário (isso é decidido no frontend), e pra
// montar a visão Master Set / % de progresso.
//
// Não é mais uma lista fixa de 6 tipos: sets recentes (ex: "Ascended Heroes" me02.5) têm
// cartas com vários padrões de foil NOMEADOS na mesma carta ao mesmo tempo (`variants_detailed
// [].foil`: "friendball", "energy", "loveball", "league", além de "pokeball"/"masterball", já
// tratados à parte antes) - cada um é uma impressão física distinta, com produto/preço
// próprios, não uma sub-variação de "Reverse Foil" genérico. `flags` agora ganha uma chave
// dinâmica por padrão nomeado encontrado, além dos 4 tipos genéricos (Standard/Foil/Reverse
// Foil/First Edition).
const CACHE_VARIANTS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias - dado histórico, não muda

interface CardLegal {
  standard: boolean;
  expanded: boolean;
}

// Nomes conhecidos de padrão de foil -> rótulo bonito exibido no app. Comparação é feita
// depois de normalizar o texto cru (remover acentos/espaços/maiúsculas), porque o mesmo padrão
// aparece formatado diferente dependendo do locale consultado (ex: "pokeball" no inglês/dado
// bruto da TCGdex vs "Poké Bola" no `pt`). Um padrão NÃO listado aqui ainda funciona (a
// variação aparece com o nome cru capitalizado) - só o rótulo fica menos bonito até eu
// adicionar uma entrada específica pra ele.
const FOIL_PATTERN_LABELS: [needle: string, label: string][] = [
  ['poke', 'Pokeball'],
  ['master', 'Master Ball'],
  ['friend', 'Friend Ball'],
  ['love', 'Love Ball'],
  ['league', 'League'],
  ['energy', 'Energy'],
  ['cosmos', 'Cosmos'],
];

const normalizeFoilKey = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function prettifyFoilName(raw: string): string {
  const normalized = normalizeFoilKey(raw);
  const match = FOIL_PATTERN_LABELS.find(([needle]) => normalized.includes(needle));
  if (match) return match[1];
  const trimmed = raw.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Deriva um flag de tipo genérico (Standard/Foil/Reverse Foil/First Edition) a partir de
// variants_detailed quando disponível: só é true se existir pelo menos uma impressão desse
// tipo SEM padrão de foil nomeado - uma carta pode ter reverse só em versões nomeadas (ex:
// Charmander de "Ascended Heroes" só tem reverse "Friend Ball" e reverse "Energy", nenhuma
// reverse genérica); marcar "Reverse Foil" true nesse caso criaria uma 3ª variação fantasma
// que não existe fisicamente. Sem nenhuma entrada desse tipo em variants_detailed (dado
// indisponível pra essa carta), cai pro booleano de `variants` como sempre foi.
function genericTypeFlag(detailed: any[], type: string, fallback: boolean): boolean {
  const entriesOfType = detailed.filter(entry => String(entry?.type || '').toLowerCase() === type);
  if (entriesOfType.length === 0) return fallback;
  return entriesOfType.some(entry => !entry?.foil);
}

function extractVariantFlags(detail: any): { flags: Record<string, boolean>; rarity: string; artist: string; category: string; legal: CardLegal } {
  const v = detail?.variants || {};
  const detailed: any[] = Array.isArray(detail?.variants_detailed) ? detail.variants_detailed : [];

  const flags: Record<string, boolean> = {
    Standard: genericTypeFlag(detailed, 'normal', !!v.normal),
    Foil: genericTypeFlag(detailed, 'holo', !!v.holo),
    'Reverse Foil': genericTypeFlag(detailed, 'reverse', !!v.reverse),
    'First Edition': genericTypeFlag(detailed, 'firstedition', !!v.firstEdition),
  };

  // Sets recém-lançados (ex: "me04" Caos Ascendente) às vezes têm o produto reverse holofoil
  // precificado em variants_detailed[].pricing.tcgplayer mas a TCGdex ainda nem separou uma
  // entrada "reverse" pra ele em variants_detailed (nem falar do booleano `variants.reverse`,
  // que também atrasa - ver "me05" Escuridão Absoluta, que se corrigiu sozinho depois). Só
  // entra em ação quando não existe NENHUMA entrada "reverse" ainda (senão o cálculo acima já
  // decidiu certo, nomeada ou não).
  if (!detailed.some(entry => String(entry?.type || '').toLowerCase() === 'reverse')) {
    const hasReversePricingHint = detailed.some(entry => {
      const tcgplayerKeys = Object.keys(entry?.pricing?.tcgplayer || {});
      return tcgplayerKeys.some(key => key.toLowerCase().includes('reverse'));
    });
    if (hasReversePricingHint) flags['Reverse Foil'] = true;
  }

  // Cada entrada com um padrão de foil nomeado vira sua própria variação colecionável, além
  // dos 4 tipos genéricos acima - substitui o antigo tratamento especial só de Pokeball/Master
  // Ball por um mecanismo genérico que cobre qualquer nome que a TCGdex introduzir.
  for (const entry of detailed) {
    const foilName = entry?.foil;
    if (!foilName) continue;
    flags[prettifyFoilName(String(foilName))] = true;
  }

  return {
    flags,
    rarity: detail?.rarity || '',
    artist: detail?.illustrator || '',
    category: detail?.category || '',
    // Legalidade de torneio (usada pra tag Standard/Expanded dos Decks) - vem por carta (não
    // por set), já que a mesma coleção pode ter reimpressões com legalidades diferentes.
    legal: { standard: !!detail?.legal?.standard, expanded: !!detail?.legal?.expanded },
  };
}

// Busca as flags de variação de uma carta na TCGdex e atualiza o cache - extraído do handler
// de /card-variants/:cardId (mesma lógica de locale/fallback/cache) pra ser reutilizado por
// /sets/:setId/variant-flags, que precisa disso pra várias cartas de uma vez sem depender de
// uma resposta HTTP por carta.
async function fetchAndCacheCardVariantInfo(cardId: string, cached: { data: any; updated_at: string } | null): Promise<any> {
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
    return result;
  } catch (err) {
    console.warn(`[tcg] Falha ao buscar variantes da carta ${cardId}:`, (err as Error).message);
    if (cached) {
      return cached.data;
    }
    // Sem dado nenhum: devolve flags vazias - o frontend trata "sem dado" como "mostra tudo".
    return { flags: {}, rarity: '', artist: '', category: '', legal: { standard: false, expanded: false } };
  }
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

    return res.json(await fetchAndCacheCardVariantInfo(cardId, cached));
  })
);

// Flags de variação de TODAS as cartas de um set de uma vez (mesmo dado de /card-variants/
// :cardId, em lote) - usado pra calcular a % de "Variações" do progresso em camadas e pra
// montar a visão Master Set, que precisam saber, pra cada carta do set, quais variações ela
// realmente tem. Buscar isso uma carta de cada vez do frontend faria até ~250 requisições
// (tamanho de um set grande) só pra abrir a tela.
tcgRouter.get(
  '/sets/:setId/variant-flags',
  asyncHandler(async (req, res) => {
    const parsed = setIdSchema.safeParse(req.params.setId);
    if (!parsed.success) {
      return res.status(400).json({ error: 'ID de coleção inválido.' });
    }
    const setId = parsed.data;

    const { data: setCards } = await fetchAndCacheSetCards(setId);
    const cardIds = (setCards || []).map((c: any) => c.id);
    if (cardIds.length === 0) {
      return res.json({});
    }

    const { data: cachedRows } = await supabase.from('card_variants_cache').select('card_id, data, updated_at').in('card_id', cardIds);
    const cachedByCardId = new Map((cachedRows || []).map((r: any) => [r.card_id, r]));

    const result: Record<string, any> = {};
    const toFetch: string[] = [];
    for (const cardId of cardIds) {
      const cached = cachedByCardId.get(cardId);
      const isFresh = cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_VARIANTS_TTL_MS;
      if (cached && isFresh) {
        result[cardId] = cached.data;
      } else {
        toFetch.push(cardId);
      }
    }

    // Mesmo limite de concorrência usado pra montar o catálogo (ver mapConcurrent acima) -
    // um set com cache totalmente frio não deve disparar centenas de chamadas simultâneas
    // pra TCGdex de uma vez só.
    await mapConcurrent(toFetch, 10, async (cardId) => {
      result[cardId] = await fetchAndCacheCardVariantInfo(cardId, cachedByCardId.get(cardId) || null);
    });

    return res.json(result);
  })
);

const decklistLineSchema = z.object({
  index: z.number().int().min(0),
  code: z.string().trim().min(1).max(10),
  number: z.string().trim().min(1).max(10),
});
const resolveDecklistSchema = z.object({
  lines: z.array(decklistLineSchema).min(1).max(60),
});

const resolveDecklistLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

// Resolve linhas de decklist coladas (ex: "TEF 113") pro id de carta interno - usado pela
// importação de Decks. `code` é o código curto (Limitless/PTCGO) do set, casado contra
// `code` em /sets (vindo de `abbreviation.official` na TCGdex, ver mapSet acima); ausente/
// sem match vira "unresolved" pro usuário resolver manualmente, nunca um chute silencioso.
const normalizeCardNumber = (n: string) => n.trim().replace(/^0+(?=.)/, '').toLowerCase();

tcgRouter.post(
  '/resolve-decklist',
  resolveDecklistLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = resolveDecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Lista inválida.' });
    }

    const { data: setsCached } = await supabase.from('sets_cache').select('data').eq('id', 'all').maybeSingle();
    const sets: any[] = setsCached?.data || FALLBACK_SETS;
    const setsByCode = new Map<string, any[]>();
    for (const s of sets) {
      if (!s.code) continue;
      const key = String(s.code).toUpperCase();
      if (!setsByCode.has(key)) setsByCode.set(key, []);
      setsByCode.get(key)!.push(s);
    }

    const resolved: { index: number; cardId: string }[] = [];
    const unresolved: number[] = [];
    const cardsBySetCache = new Map<string, any[]>();

    for (const line of parsed.data.lines) {
      const candidateSets = setsByCode.get(line.code.toUpperCase()) || [];
      let match: string | null = null;
      for (const set of candidateSets) {
        let cards = cardsBySetCache.get(set.id);
        if (!cards) {
          const result = await fetchAndCacheSetCards(set.id);
          cards = result.data;
          cardsBySetCache.set(set.id, cards);
        }
        // Números do catálogo vêm com zero à esquerda (ex: "008"), decklists coladas normalmente
        // não ("8") - compara normalizado dos dois lados pra não perder o match por causa disso.
        const card = cards.find((c: any) => normalizeCardNumber(String(c.number)) === normalizeCardNumber(line.number));
        if (card) {
          match = card.id;
          break;
        }
      }
      if (match) {
        resolved.push({ index: line.index, cardId: match });
      } else {
        unresolved.push(line.index);
      }
    }

    return res.json({ resolved, unresolved });
  })
);
