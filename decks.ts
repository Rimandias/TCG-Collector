import { Deck } from './types';

// Decks ainda não fazem parte do FullUser sincronizado pelo backend (server/src/routes/users.ts
// valida o payload do PUT /api/users/me com um schema fechado - qualquer campo fora dele é
// descartado). Até essa persistência ser desenhada (nova tabela + diff no replaceUserData,
// igual trade_folders), decks ficam em localStorage por conta, namespaced por usuário.
const STORAGE_PREFIX = 'poketracker_decks_';

export const loadDecks = (userId: string): Deck[] => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

export const saveDecks = (userId: string, decks: Deck[]) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(decks));
  } catch (e) {
    // localStorage indisponível, segue sem persistir
  }
};
