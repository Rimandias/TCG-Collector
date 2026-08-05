import { Deck, DeckCard } from './types';
import { getAccessToken } from './auth';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

export const MAX_DECKS = 5;
export const MAX_DECK_CARDS = 60;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export const getMyDecks = async (): Promise<Deck[]> => {
  const response = await fetch(`${API_BASE}/decks`, { headers: await authHeaders() });
  if (!response.ok) return [];
  const body = await response.json();
  return body.decks || [];
};

export const createDeck = async (name: string): Promise<{ deck?: Deck; error?: string }> => {
  const response = await fetch(`${API_BASE}/decks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) return { error: await parseErrorMessage(response, 'Não foi possível criar o deck.') };
  const body = await response.json();
  return { deck: body.deck };
};

export const updateDeck = async (
  deckId: string,
  updates: { name?: string; cards?: DeckCard[] }
): Promise<{ deck?: Deck; error?: string }> => {
  const response = await fetch(`${API_BASE}/decks/${encodeURIComponent(deckId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(updates),
  });
  if (!response.ok) return { error: await parseErrorMessage(response, 'Não foi possível salvar o deck.') };
  const body = await response.json();
  return { deck: body.deck };
};

export const deleteDeck = async (deckId: string): Promise<boolean> => {
  const response = await fetch(`${API_BASE}/decks/${encodeURIComponent(deckId)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  return response.ok;
};

// --- Importação/exportação em formato de decklist (Limitless/PTCGO) ---
//
// Pokémon: 18
// 4 Beldum TEF 113
// ...
//
// Cada linha de carta é "<qtd> <nome> <código do set> <número>". O nome pode ter espaços
// (inclusive apóstrofo, ex: "Ethan's Pichu"), então o parser sempre lê os DOIS últimos
// tokens como código+número e tudo entre a quantidade e eles como nome - é o que permite
// nomes de tamanho variável sem confundir com o código/número.
export interface ParsedDeckLine {
  raw: string;
  quantity: number;
  name: string;
  code: string;
  number: string;
}

const DECK_LINE_PATTERN = /^(\d+)\s+(.+?)\s+(\S+)\s+(\S+)$/;

export function parseDecklistText(text: string): ParsedDeckLine[] {
  const lines: ParsedDeckLine[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(DECK_LINE_PATTERN);
    if (!match) continue; // cabeçalhos ("Pokémon: 18" etc.) e linhas em branco são ignorados
    const [, qty, name, code, number] = match;
    lines.push({ raw: line, quantity: parseInt(qty, 10), name, code, number });
  }
  return lines;
}

export interface DeckExportCardInfo {
  cardId: string;
  quantity: number;
  name: string;
  number: string;
  setCode: string;
  category: string;
}

// Ordem/rótulos fixos no padrão de decklist (Limitless/PTCGO) - são os cabeçalhos de
// seção convencionais dessa comunidade, sempre nesses termos independente do idioma.
export const DECK_CATEGORY_ORDER = ['Pokemon', 'Trainer', 'Energy'] as const;
export const DECK_CATEGORY_LABELS: Record<string, string> = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy', Outras: 'Outras' };

// A TCGdex devolve a categoria da carta traduzida (locale `pt`: "Pokémon"/"Treinador"/
// "Energia"; fallback `en`: "Pokemon"/"Trainer"/"Energy" quando a carta não tem pt) - mapeia
// os dois pra chave interna fixa. Sem match (categoria vazia/desconhecida) cai em "Outras".
export function categorizeCard(rawCategory: string): string {
  const normalized = rawCategory.trim().toLowerCase();
  if (normalized === 'pokémon' || normalized === 'pokemon') return 'Pokemon';
  if (normalized === 'treinador' || normalized === 'trainer') return 'Trainer';
  if (normalized === 'energia' || normalized === 'energy') return 'Energy';
  return 'Outras';
}

// Formato inverso do parser acima - agrupado por categoria, na mesma ordem em que ela
// normalmente aparece numa decklist copiada (Pokémon, depois Trainer, depois Energy).
export function formatDecklistText(cards: DeckExportCardInfo[]): string {
  const groups = new Map<string, DeckExportCardInfo[]>();
  for (const card of cards) {
    const key = categorizeCard(card.category);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }

  const sections: string[] = [];
  for (const key of [...DECK_CATEGORY_ORDER, 'Outras']) {
    const group = groups.get(key);
    if (!group || group.length === 0) continue;
    const total = group.reduce((sum, c) => sum + c.quantity, 0);
    const body = group.map((c) => `${c.quantity} ${c.name} ${c.setCode} ${c.number}`).join('\n');
    sections.push(`${DECK_CATEGORY_LABELS[key] || key}: ${total}\n${body}`);
  }
  return sections.join('\n\n');
}
