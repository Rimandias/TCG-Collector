
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
  'Pre release',
  'Staff',
  'First Edition'
];

export interface ConditionDetails {
  quantity: number;
  price?: string;
}

export interface Card {
  id: string;
  name: string;
  imageUrl: string;
  imageUrlHiRes: string;
  number: string;
  rarity: string;
  isSecret: boolean;
  set: {
    id: string;
    name: string;
    printedTotal?: number;
  }
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
  ownedCards: Record<string, UserCardData>;
  friends: Friend[];
  folders?: TradeFolder[];
  wishlist?: string[];
}

export interface TradeFolder {
  id: string;
  name: string;
  cardIds: string[];
  visibleToFriends: boolean;
}

export interface TradeItem {
  cardId: string;
  variation: string;
  condition: string;
  quantity: number;
  unitPrice: number;
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
  SETTINGS = 'settings'
}
