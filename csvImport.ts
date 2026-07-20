import { Card, CardCondition, PokemonSet, User } from './types';
import { fetchSets, fetchCardsBySet } from './api';
import { getNormalizedVariations, adjustLanguageQuantity } from './db';

// Parser de CSV no formato RFC4180 (lida com campos entre aspas contendo vírgulas
// e quebras de linha, e aspas duplicadas "" como escape de aspas literais) - o
// arquivo exportado pelo LigaPokemon usa esse formato nas células de instrução.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function colIndex(header: string[], label: string): number {
  return header.findIndex((h) => (h || '').split('\n')[0].trim().toLowerCase() === label.toLowerCase());
}

// Nome da "Edição" (coluna em português do export do LigaPokemon) -> nome oficial
// em inglês do catálogo (Pokemon TCG API). Coleções exclusivas do Japão não têm
// equivalente aqui de propósito - o catálogo só cobre lançamentos ocidentais, então
// essas linhas simplesmente não encontram nenhum set e são ignoradas no resumo.
const SET_NAME_TRANSLATIONS: Record<string, string> = {
  'coleção básica': 'base',
  'selva': 'jungle',
  'fóssil': 'fossil',
  'rubi & safira': 'ruby & sapphire',
  'maravilhas secretas': 'secret wonders',
  'chamado das lendas': 'call of legends',
  'gerações': 'generations',
  'triunfante': 'triumphant',
  'heartgold soulsilver': 'heartgold & soulsilver',
  'destinos ocultos': 'hidden fates',
  'diamante & pérola': 'diamond & pearl',
  'congelamento de plasma': 'plasma freeze',
  'cerco de vapor': 'steam siege',
  'caminho do campeão': "champion's path",
  'vitórias nobres': 'noble victories',
  'punhos furiosos': 'furious fists',
  'conflito primitivo': 'primal clash',
  'turbo colisão': 'breakpoint',
  'lendas luminescentes': 'shining legends',
  'tempestade celestial': 'celestial storm',
  'eclipse cósmico': 'cosmic eclipse',
  'origem perdida': 'lost origin',
  'estilos de batalha': 'battle styles',
  'espada e escudo': 'sword & shield',
  'estrelas radiantes': 'astral radiance',
  'astros cintilantes': 'brilliant stars',
  'voltagem vívida': 'vivid voltage',
  'destemido': 'undaunted',
  'fusão de destinos': 'fates collide',
  'tempestade prateada': 'silver tempest',
  'tempestade de plasma': 'plasma storm',
  'sol e lua': 'sun & moon',
  'exploradores da escuridão': 'dark explorers',
  'próximos destinos': 'next destinies',
  'dragões enaltecidos': 'dragons exalted',
  'revelado': 'unleashed',
  'poderes emergentes': 'emerging powers',
};

function findMatchingSet(edicao: string, sets: PokemonSet[]): PokemonSet | undefined {
  const rawNorm = normalize(edicao);
  const translated = SET_NAME_TRANSLATIONS[edicao.trim().toLowerCase()];
  const translatedNorm = translated ? normalize(translated) : null;

  let match = sets.find((s) => normalize(s.name) === rawNorm);
  if (match) return match;

  if (translatedNorm) {
    match = sets.find((s) => normalize(s.name) === translatedNorm);
    if (match) return match;
  }

  return sets.find((s) => {
    const n = normalize(s.name);
    if (n.includes(rawNorm) || rawNorm.includes(n)) return true;
    if (translatedNorm && (n.includes(translatedNorm) || translatedNorm.includes(n))) return true;
    return false;
  });
}

// Colunas de flag (0/1) da planilha -> variação correspondente no nosso modelo.
// Assinada/Promo/Textless/Alterada/Shadowless/Oversize/Misprint/Shattered Holo não
// têm variação equivalente no app hoje, então não alteram a variação escolhida.
const VARIATION_FLAG_COLUMNS: { header: string; variation: string }[] = [
  { header: 'Foil', variation: 'Foil' },
  { header: 'Reverse Foil', variation: 'Reverse Foil' },
  { header: 'Pokeball Foil', variation: 'Pokeball' },
  { header: 'Master Ball', variation: 'Master Ball' },
  { header: 'Pre Release', variation: 'Pre release' },
  { header: 'Staff', variation: 'Staff' },
  { header: 'Edition One', variation: 'First Edition' },
];

// O app usa BR como código padrão pro português (em vez do PT do LigaPokemon).
const IMPORT_LANGUAGE_ALIASES: Record<string, string> = {
  PT: 'BR',
};

// Nosso app não distingue "Mint" de "Near Mint" - trata como NM.
const QUALITY_TO_CONDITION: Record<string, CardCondition> = {
  M: CardCondition.NM,
  NM: CardCondition.NM,
  SP: CardCondition.SP,
  MP: CardCondition.MP,
  HP: CardCondition.HP,
  D: CardCondition.D,
};

export interface ImportRowResult {
  status: 'imported' | 'skipped';
  reason?: string;
  cardName?: string;
  setName?: string;
  quantity?: number;
}

export interface ImportSummary {
  results: ImportRowResult[];
  importedCount: number;
  skippedCount: number;
  updatedUser: User;
}

export async function importCollectionCsv(user: User, csvText: string): Promise<ImportSummary> {
  const rows = parseCsv(csvText);
  const headerIdx = rows.findIndex((r) => (r[0] || '').trim() === 'Tipo');
  if (headerIdx === -1) {
    throw new Error('Não foi possível identificar o cabeçalho do arquivo. Confira se é o modelo de exportação correto.');
  }
  const header = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.some((c) => c.trim() !== ''));

  const idx = {
    edicao: colIndex(header, 'Edição'),
    numero: colIndex(header, 'Número'),
    idioma: colIndex(header, 'Idioma'),
    qualidade: colIndex(header, 'Qualidade'),
    quantidadeExistente: colIndex(header, 'Quantidade Existente'),
    preco: colIndex(header, 'Preço'),
    nomeEn: colIndex(header, 'Nome da Carta EN'),
    nomePt: colIndex(header, 'Nome da Carta PT'),
  };
  if (idx.edicao === -1 || idx.numero === -1 || idx.quantidadeExistente === -1 || idx.preco === -1) {
    throw new Error('O arquivo não tem as colunas esperadas (Edição, Número, Quantidade Existente, Preço).');
  }
  const flagIdx = VARIATION_FLAG_COLUMNS.map((f) => ({ ...f, idx: colIndex(header, f.header) }));

  const sets = (await fetchSets()) as PokemonSet[];
  const results: ImportRowResult[] = [];
  const ownedCards = { ...user.ownedCards };

  // Resolve a coleção de cada linha antes de buscar as cartas, para poder buscar
  // todas as coleções necessárias em paralelo (bem mais rápido que uma por vez,
  // especialmente em coleções com muitas edições diferentes).
  const setByEdicao = new Map<string, PokemonSet | null>();
  for (const row of dataRows) {
    const edicao = (row[idx.edicao] || '').trim();
    if (!edicao || setByEdicao.has(edicao)) continue;
    setByEdicao.set(edicao, findMatchingSet(edicao, sets) || null);
  }
  const uniqueSetIds = Array.from(new Set(Array.from(setByEdicao.values()).filter((s): s is PokemonSet => !!s).map((s) => s.id)));
  const cardsBySetCache: Record<string, Card[]> = {};
  const failedSetIds = new Set<string>();
  await Promise.all(
    uniqueSetIds.map(async (setId) => {
      let cards = (await fetchCardsBySet(setId)) as Card[];
      if (cards.length === 0) {
        // Buscar ~50 coleções em paralelo ocasionalmente esbarra em falha de rede
        // transitória - tenta mais uma vez antes de desistir dessa coleção.
        await new Promise((resolve) => setTimeout(resolve, 400));
        cards = (await fetchCardsBySet(setId)) as Card[];
      }
      cardsBySetCache[setId] = cards;
      if (cards.length === 0) failedSetIds.add(setId);
    })
  );

  for (const row of dataRows) {
    const edicao = (row[idx.edicao] || '').trim();
    const numero = (row[idx.numero] || '').trim();
    const quantidadeStr = (row[idx.quantidadeExistente] || '').trim();
    const precoStr = (row[idx.preco] || '').trim();
    const nomeExibicao = (row[idx.nomeEn] || '').trim() || (idx.nomePt >= 0 ? (row[idx.nomePt] || '').trim() : '') || `#${numero}`;

    if (!edicao || !numero || !quantidadeStr || !precoStr) {
      results.push({ status: 'skipped', reason: 'Linha incompleta (faltando coleção, número, quantidade ou preço).', cardName: nomeExibicao, setName: edicao });
      continue;
    }

    const quantity = parseInt(quantidadeStr, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      results.push({ status: 'skipped', reason: 'Quantidade inválida.', cardName: nomeExibicao, setName: edicao });
      continue;
    }

    const matchedSet = setByEdicao.get(edicao) || undefined;
    if (!matchedSet) {
      results.push({
        status: 'skipped',
        reason: 'Coleção não encontrada no catálogo (provavelmente uma edição japonesa, que não é suportada).',
        cardName: nomeExibicao,
        setName: edicao,
      });
      continue;
    }

    const cardsInSet = cardsBySetCache[matchedSet.id] || [];
    if (failedSetIds.has(matchedSet.id)) {
      results.push({
        status: 'skipped',
        reason: `Não foi possível carregar as cartas de "${matchedSet.name}" agora (falha de rede). Tente importar o arquivo novamente.`,
        cardName: nomeExibicao,
        setName: matchedSet.name,
      });
      continue;
    }
    const numeroNorm = numero.replace(/^0+(?=\d)/, '');
    const matchedCard = cardsInSet.find((c) => c.number.replace(/^0+(?=\d)/, '') === numeroNorm);
    if (!matchedCard) {
      results.push({
        status: 'skipped',
        reason: `Carta número ${numero} não encontrada em "${matchedSet.name}".`,
        cardName: nomeExibicao,
        setName: matchedSet.name,
      });
      continue;
    }

    const qualidadeRaw = (row[idx.qualidade] || '').trim().toUpperCase();
    const condition = QUALITY_TO_CONDITION[qualidadeRaw] || CardCondition.NM;
    const variationName = flagIdx.find((f) => f.idx >= 0 && (row[f.idx] || '').trim() === '1')?.variation || 'Standard';
    const languageRaw = (row[idx.idioma] || '').trim().toUpperCase();
    const languageCode = IMPORT_LANGUAGE_ALIASES[languageRaw] || languageRaw;

    const current = ownedCards[matchedCard.id] || { cardId: matchedCard.id, isOwned: false, isForTrade: false, variations: {} };
    const normalized = getNormalizedVariations(current.variations);
    const details = normalized[variationName][condition];
    normalized[variationName][condition] = adjustLanguageQuantity(details, languageCode, quantity, precoStr);

    ownedCards[matchedCard.id] = {
      ...current,
      cardId: matchedCard.id,
      isOwned: true,
      variations: normalized,
    };

    results.push({ status: 'imported', cardName: matchedCard.name, setName: matchedSet.name, quantity });
  }

  const updatedUser: User = { ...user, ownedCards };
  return {
    results,
    importedCount: results.filter((r) => r.status === 'imported').length,
    skippedCount: results.filter((r) => r.status === 'skipped').length,
    updatedUser,
  };
}
