
export enum CardCondition {
  NM = 'NM',
  SP = 'SP',
  MP = 'MP',
  HP = 'HP',
  D = 'D'
}

export const VARIATION_TYPES = [
  'Standard',
  'Foil',
  'Reverse Foil',
  'Pokeball',
  'Master Ball',
  'First Edition'
];

// Mesmos códigos de idioma usados pela planilha de importação (LigaPokemon), exceto
// BR (idioma padrão do app) no lugar de PT - a importação de CSV converte PT -> BR.
export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'BR', label: 'Português' },
  { code: 'EN', label: 'Inglês' },
  { code: 'JP', label: 'Japonês' },
  { code: 'DE', label: 'Alemão' },
  { code: 'ES', label: 'Espanhol' },
  { code: 'FR', label: 'Francês' },
  { code: 'IT', label: 'Italiano' },
  { code: 'PL', label: 'Polonês' },
  { code: 'RU', label: 'Russo' },
  { code: 'KO', label: 'Coreano' },
  { code: 'ID', label: 'Indonésio' },
  { code: 'TH', label: 'Tailandês' },
  { code: 'TW', label: 'Chinês (Taiwan)' },
  { code: 'TK', label: 'Turco' },
  { code: 'PTEN', label: 'Português/Inglês' },
];

// Bandeira exibida em vez de texto pra identificar o idioma registrado de uma carta (ver
// +Info) - "EN" sempre usa a bandeira dos EUA (convenção mais comum no hobby de TCG pra
// "carta em inglês", já que a maioria das cartas em inglês em circulação no Brasil é
// impressão americana). "PTEN" (Português/Inglês, cartas bilíngues antigas) combina as duas.
export const LANGUAGE_FLAGS: Record<string, string> = {
  BR: '🇧🇷',
  EN: '🇺🇸',
  JP: '🇯🇵',
  DE: '🇩🇪',
  ES: '🇪🇸',
  FR: '🇫🇷',
  IT: '🇮🇹',
  PL: '🇵🇱',
  RU: '🇷🇺',
  KO: '🇰🇷',
  ID: '🇮🇩',
  TH: '🇹🇭',
  TW: '🇹🇼',
  TK: '🇹🇷',
  PTEN: '🇧🇷🇺🇸',
};

export const getLanguageFlag = (code?: string): string | null => (code ? LANGUAGE_FLAGS[code] || null : null);

export interface LanguageDetails {
  quantity: number;
  price?: string;
}

export interface ConditionDetails {
  quantity: number;
  price?: string;
  // Detalhamento opcional por idioma de impressão. Quando presente, quantity/price
  // acima são o agregado (soma) de todos os idiomas - o resto do app (trocas,
  // estatísticas, pasta de amigos) continua lendo só quantity/price normalmente.
  languages?: Record<string, LanguageDetails>;
}

export interface Card {
  id: string;
  name: string;
  imageUrl: string;
  imageUrlHiRes: string;
  number: string;
  rarity: string;
  artist?: string;
  isSecret: boolean;
  set: {
    id: string;
    name: string;
    printedTotal?: number;
  }
  // Pokémon/Trainer/Energy - só vem preenchido depois de consultar /card-variants (não vem
  // na listagem em lote da TCGdex). Usado pra agrupar decks na exportação/exibição.
  category?: string;
}

export interface PokemonSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  logoUrl: string;
  symbolUrl: string;
  releaseDate: string;
  updatedAt: string;
}

export interface UserCardData {
  cardId: string;
  isOwned: boolean;
  isForTrade: boolean;
  variations: Record<string, any>;
}

export interface Friend {
  userId: string;
  username: string;
  avatarUrl: string;
  addedAt: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  friendCode: string;
  isPremium: boolean;
  ownedCards: Record<string, UserCardData>;
  friends: Friend[];
  folders?: TradeFolder[];
  wishlist?: string[];
}

export interface TradeFolderVariationSelection {
  variation: string;
  condition: string;
  language?: string;
  quantity: number;
}

export interface TradeFolder {
  id: string;
  name: string;
  cardIds: string[];
  visibleToFriends: boolean;
  variationSelections?: Record<string, TradeFolderVariationSelection[]>;
  // Cartas que continuam na Pasta de Repetidas mas foram ocultadas manualmente pelo dono -
  // nunca aparecem para outra pessoa (nem pela pasta de amigos, nem pelo link público),
  // ainda que continuem contando para a regra automática de duplicatas.
  hiddenCardIds?: string[];
  // Token do link público de compartilhamento (sem exigir login para visualizar) - só o
  // backend gera/revoga (rotas dedicadas em routes/share.ts), nunca escrito via PUT /users/me;
  // aqui é só leitura, pra saber se a pasta já tem link e montar a URL de compartilhamento.
  shareToken?: string | null;
}

export interface TradeItem {
  cardId: string;
  variation: string;
  condition: string;
  language?: string;
  quantity: number;
  unitPrice: number;
  // Presente (calculado no servidor) em trocas ainda abertas: false quando a carta já não
  // está mais disponível na quantidade negociada (ex: consumida por outra troca concluída
  // enquanto esta ainda estava em andamento) - não conta no valor nem é transferida ao concluir.
  available?: boolean;
}

export type TradeStatus =
  | 'pending_response'
  | 'awaiting_payment_confirmation'
  | 'selecting_offer'
  | 'awaiting_value_diff_confirmation'
  | 'completed'
  | 'cancelled';

export interface Trade {
  id: string;
  initiatorId: string;
  recipientId: string;
  status: TradeStatus;
  requestedItems: TradeItem[];
  offeredItems: TradeItem[];
  initiatorConfirmed: boolean;
  recipientConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
  initiatorUsername: string;
  recipientUsername: string;
  requestedValue: number;
  offeredValue: number;
}

export interface VisibleFolderCardEntry {
  variation: string;
  condition: string;
  language?: string;
  quantity: number;
  price: number;
}

export interface VisibleFolderCard {
  cardId: string;
  items: VisibleFolderCardEntry[];
}

export interface VisibleFolder {
  id: string;
  name: string;
  cards: VisibleFolderCard[];
}

export enum AppTab {
  HOME = 'home',
  COLLECTION = 'collection',
  TRADES = 'trades',
  DECKS = 'decks',
  SETTINGS = 'settings'
}

export interface DeckCard {
  cardId: string;
  quantity: number;
}

export interface Deck {
  id: string;
  name: string;
  createdAt: string;
  cards: DeckCard[];
}
