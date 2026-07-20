
import { User, UserCardData, Card, CardCondition, VARIATION_TYPES, ConditionDetails, LanguageDetails } from './types';

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

const emptyConditionRecord = (): Record<CardCondition, ConditionDetails> => ({
  [CardCondition.NM]: { quantity: 0, price: '' },
  [CardCondition.SP]: { quantity: 0, price: '' },
  [CardCondition.MP]: { quantity: 0, price: '' },
  [CardCondition.HP]: { quantity: 0, price: '' },
  [CardCondition.D]: { quantity: 0, price: '' },
});

// Valida/copia o detalhamento por idioma de uma condição, descartando entradas
// inválidas ou com quantidade zerada.
const normalizeLanguages = (raw: any): Record<string, LanguageDetails> | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const languages: Record<string, LanguageDetails> = {};
  for (const [code, details] of Object.entries<any>(raw)) {
    const quantity = typeof details?.quantity === 'number' ? details.quantity : 0;
    if (quantity > 0) {
      languages[code] = { quantity, price: details?.price !== undefined ? String(details.price) : '' };
    }
  }
  return Object.keys(languages).length > 0 ? languages : undefined;
};

export const getNormalizedVariations = (variations: Record<string, any>): Record<string, Record<CardCondition, ConditionDetails>> => {
  const normalized: Record<string, Record<CardCondition, ConditionDetails>> = {};

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
                price: (details as any).price !== undefined ? String((details as any).price) : '',
                languages: normalizeLanguages((details as any).languages),
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

// Ajusta a quantidade de um idioma específico dentro de uma condição, recalculando
// o agregado (quantity/price) usado pelo resto do app (trocas, estatísticas, etc.).
// delta pode ser negativo (para diminuir). Quando price é informado, atualiza o
// preço daquele idioma específico.
export const adjustLanguageQuantity = (
  details: ConditionDetails,
  languageCode: string,
  delta: number,
  price?: string
): ConditionDetails => {
  const languages: Record<string, LanguageDetails> = { ...(details.languages || {}) };
  const current = languages[languageCode] || { quantity: 0, price: '' };
  const nextQuantity = Math.max(0, (current.quantity || 0) + delta);
  const nextPrice = price !== undefined ? price : current.price;
  if (nextQuantity <= 0) {
    delete languages[languageCode];
  } else {
    languages[languageCode] = { quantity: nextQuantity, price: nextPrice };
  }
  const hasLanguages = Object.keys(languages).length > 0;
  const quantity = hasLanguages
    ? Object.values(languages).reduce((sum, l) => sum + (l.quantity || 0), 0)
    : 0;
  return {
    quantity,
    price: hasLanguages ? '' : '',
    languages: hasLanguages ? languages : undefined,
  };
};

// Define diretamente o preço de um idioma já existente numa condição.
export const setLanguagePrice = (details: ConditionDetails, languageCode: string, price: string): ConditionDetails => {
  const languages: Record<string, LanguageDetails> = { ...(details.languages || {}) };
  const current = languages[languageCode];
  if (!current) return details;
  languages[languageCode] = { ...current, price };
  return { ...details, languages };
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
      if (details.languages) {
        // Com idiomas detalhados, cada um pode ter preço próprio (ex.: cópia EN
        // custou diferente da PT) - soma por idioma em vez do agregado.
        for (const lang of Object.values(details.languages)) {
          const langPrice = parseFloat(lang.price || '');
          if (lang.quantity > 0 && !isNaN(langPrice)) {
            total += lang.quantity * langPrice;
          }
        }
      } else {
        const price = parseFloat(details.price || '');
        if (details.quantity > 0 && !isNaN(price)) {
          total += details.quantity * price;
        }
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
