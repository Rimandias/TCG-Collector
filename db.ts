
import { User, UserCardData, Card, CardCondition, VARIATION_TYPES } from './types';

// A persistência de dados do usuário (coleção, trocas, wishlist) vive no backend
// (ver auth.ts: fetchCurrentUser / persistUser). Este arquivo só contém helpers puros
// de leitura/transformação do estado do usuário em memória.

export const getCardTotalQuantity = (variations: Record<string, any>): number => {
  if (!variations) return 0;
  let total = 0;
  for (const key in variations) {
    const val = variations[key];
    if (typeof val === 'number') {
      // Old format: e.g. { NM: 2, SP: 1 }
      total += val;
    } else if (val && typeof val === 'object') {
      // New format: e.g. { "Foil": { NM: { quantity: 1, price: "10" } } }
      for (const subKey in val) {
        const subVal = val[subKey];
        if (subVal && typeof subVal === 'object' && 'quantity' in subVal) {
          total += (subVal.quantity || 0);
        } else if (typeof subVal === 'number') {
          total += subVal;
        }
      }
    }
  }
  return total;
};

const emptyConditionRecord = (): Record<CardCondition, { quantity: number; price: string }> => ({
  [CardCondition.NM]: { quantity: 0, price: '' },
  [CardCondition.SP]: { quantity: 0, price: '' },
  [CardCondition.MP]: { quantity: 0, price: '' },
  [CardCondition.HP]: { quantity: 0, price: '' },
  [CardCondition.D]: { quantity: 0, price: '' },
});

export const getNormalizedVariations = (variations: Record<string, any>): Record<string, Record<CardCondition, { quantity: number; price: string }>> => {
  const normalized: Record<string, Record<CardCondition, { quantity: number; price: string }>> = {};

  // Initialize defaults
  VARIATION_TYPES.forEach(v => {
    normalized[v] = emptyConditionRecord();
  });

  if (!variations) return normalized;

  const keys = Object.keys(variations);
  if (keys.length === 0) return normalized;

  // Detect format
  const firstKey = keys[0];
  const firstVal = variations[firstKey];

  if (typeof firstVal === 'number') {
    // Old format: e.g. { NM: 2, SP: 1 }
    // Migrate values to 'Foil'
    Object.entries(variations).forEach(([cond, qty]) => {
      const condition = cond as CardCondition;
      if (Object.values(CardCondition).includes(condition) && typeof qty === 'number') {
        normalized['Foil'][condition] = { quantity: qty, price: '' };
      }
    });
  } else {
    // New format: merge values
    Object.entries(variations).forEach(([varType, conditionsObj]) => {
      if (conditionsObj && typeof conditionsObj === 'object') {
        normalized[varType] = normalized[varType] || emptyConditionRecord();
        Object.entries(conditionsObj).forEach(([cond, details]) => {
          const condition = cond as CardCondition;
          if (Object.values(CardCondition).includes(condition)) {
            if (details && typeof details === 'object') {
              normalized[varType][condition] = {
                quantity: typeof (details as any).quantity === 'number' ? (details as any).quantity : 0,
                price: (details as any).price !== undefined ? String((details as any).price) : ''
              };
            } else if (typeof details === 'number') {
              normalized[varType][condition] = {
                quantity: details,
                price: ''
              };
            }
          }
        });
      }
    });
  }

  return normalized;
};

export const getInitialCardData = (cardId: string): UserCardData => {
  const variations: Record<string, any> = {};
  VARIATION_TYPES.forEach(v => {
    variations[v] = {
      [CardCondition.NM]: { quantity: 0, price: '' },
      [CardCondition.SP]: { quantity: 0, price: '' },
      [CardCondition.MP]: { quantity: 0, price: '' },
      [CardCondition.HP]: { quantity: 0, price: '' },
      [CardCondition.D]: { quantity: 0, price: '' },
    };
  });
  return {
    cardId,
    isOwned: false,
    isForTrade: false,
    variations
  };
};

export const updateCardStatus = (user: User, cardId: string, updates: Partial<UserCardData>): User => {
  const current = user.ownedCards[cardId] || getInitialCardData(cardId);
  const updatedCard = { ...current, ...updates };
  
  // Auto-set isOwned if any variation count > 0, otherwise reset owned and trade flags
  const totalQty = getCardTotalQuantity(updatedCard.variations);
  if (totalQty > 0) {
    updatedCard.isOwned = true;
  } else {
    updatedCard.isOwned = false;
    updatedCard.isForTrade = false;
  }

  const newUser = {
    ...user,
    ownedCards: {
      ...user.ownedCards,
      [cardId]: updatedCard
    }
  };
  return newUser;
};

// Valor estimado de uma carta = soma de (quantidade * preço) que o próprio usuário
// preencheu em cada combinação de variação/condição. Não usa nenhum preço de mercado externo.
export const getCardEstimatedValue = (variations: Record<string, any>): number => {
  const normalized = getNormalizedVariations(variations);
  let total = 0;
  for (const varType in normalized) {
    for (const cond in normalized[varType]) {
      const details = normalized[varType][cond as CardCondition];
      const price = parseFloat(details.price);
      if (details.quantity > 0 && !isNaN(price)) {
        total += details.quantity * price;
      }
    }
  }
  return total;
};

export const getCompleteCardNumber = (card: Card): string => {
  if (card.set && card.set.printedTotal) {
    return `${card.number}/${card.set.printedTotal}`;
  }
  return card.number;
};
