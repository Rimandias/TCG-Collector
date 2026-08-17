
import { Card, User, VARIATION_TYPES } from './types';
import { getCardTotalQuantity, getNormalizedVariations, getVariationSubtotal } from './db';
import { CardVariantInfo } from './api';

export type SetTierColor = 'green' | 'blue' | 'purple';

export interface SetTierStats {
  regularPercent: number;
  secretPercent: number;
  variationPercent: number;
  totalPercent: number;
  tierColor: SetTierColor;
  regularOwned: number;
  regularTotal: number;
  secretOwned: number;
  secretTotal: number;
  variationOwned: number;
  variationTotal: number;
}

const isCardOwned = (ownedCards: User['ownedCards'], cardId: string): boolean =>
  getCardTotalQuantity(ownedCards[cardId]?.variations) > 0;

// Monta o resultado final a partir das contagens já apuradas (regular/secreta/variação) -
// compartilhado pelas duas formas de calcular essas contagens abaixo (com a lista completa
// de cartas do set, ou só a partir dos ids já possuídos + metadados do set).
//
// tierColor é sequencial, não "cada categoria em 100%": fica verde enquanto as regulares não
// completam; assim que completam vira azul (mesmo com secretas/variações ainda incompletas)
// até as secretas também completarem, aí vira roxo - a % de variações nunca segura a cor
// sozinha, só marca o quanto falta depois de roxo. Um set sem nenhuma rara secreta
// (secretTotal === 0) não tem uma fase "Complete Set" separada da "Base Set" pra completar,
// então secretPercent já nasce 100%.
//
// totalPercent é a soma das três (cada uma 0-100, então o total pode passar de 100/200%) -
// cada camada conta inteira, não é uma média.
const buildStats = (
  regularOwned: number,
  regularTotal: number,
  secretOwned: number,
  secretTotal: number,
  variationOwned: number,
  variationTotal: number
): SetTierStats => {
  const regularPercent = regularTotal > 0 ? (regularOwned / regularTotal) * 100 : 100;
  const secretPercent = secretTotal > 0 ? (secretOwned / secretTotal) * 100 : 100;
  const variationPercent = variationTotal > 0 ? (variationOwned / variationTotal) * 100 : 0;
  const tierColor: SetTierColor = regularPercent < 100 ? 'green' : secretPercent < 100 ? 'blue' : 'purple';

  return {
    regularPercent,
    secretPercent,
    variationPercent,
    totalPercent: regularPercent + secretPercent + variationPercent,
    tierColor,
    regularOwned,
    regularTotal,
    secretOwned,
    secretTotal,
    variationOwned,
    variationTotal,
  };
};

// Quantos "slots" carta+variação existem (variationTotal) e quantos o usuário tem pelo menos
// 1 unidade (variationOwned), contando só variações que a TCGdex confirma que a carta
// realmente tem. Cartas sem esse dado ainda carregado (chave ausente em variantFlagsByCardId)
// não entram nem no numerador nem no denominador, pra não distorcer a % enquanto os dados
// chegam aos poucos (ver GET /tcg/sets/:id/variant-flags).
const countVariationSlots = (
  cardIds: string[],
  ownedCards: User['ownedCards'],
  variantFlagsByCardId: Record<string, CardVariantInfo> | undefined
): { owned: number; total: number } => {
  let total = 0;
  let owned = 0;
  if (!variantFlagsByCardId) return { owned, total };
  for (const cardId of cardIds) {
    const flags = variantFlagsByCardId[cardId]?.flags;
    if (!flags) continue;
    const cardVariationTypes = VARIATION_TYPES.filter(v => flags[v] === true);
    if (cardVariationTypes.length === 0) continue;
    const normalized = getNormalizedVariations(ownedCards[cardId]?.variations || {});
    for (const variation of cardVariationTypes) {
      total += 1;
      if (getVariationSubtotal(normalized[variation]) > 0) owned += 1;
    }
  }
  return { owned, total };
};

// Progresso em 3 camadas (Base Set/Complete Set/Master Set) por trás da barra colorida, a
// partir da lista completa de cartas do set já carregada (tela de detalhe do set, que
// precisa dela de qualquer forma pra renderizar a grade de cartas).
export const getSetTierStats = (
  setCards: Card[],
  ownedCards: User['ownedCards'],
  variantFlagsByCardId: Record<string, CardVariantInfo> | undefined
): SetTierStats => {
  const regularCards = setCards.filter(c => !c.isSecret);
  const secretCards = setCards.filter(c => c.isSecret);
  const regularOwned = regularCards.filter(c => isCardOwned(ownedCards, c.id)).length;
  const secretOwned = secretCards.filter(c => isCardOwned(ownedCards, c.id)).length;

  const { owned: variationOwned, total: variationTotal } = countVariationSlots(
    setCards.map(c => c.id),
    ownedCards,
    variantFlagsByCardId
  );

  return buildStats(regularOwned, regularCards.length, secretOwned, secretCards.length, variationOwned, variationTotal);
};

// Mesma coisa, mas sem precisar da lista completa de cartas do set - só o resumo do set
// (printedTotal/total, já disponíveis em qualquer PokemonSet) e os ids que o usuário possui.
// Regular/secreta são derivados comparando o número da carta (sufixo do id, ex: "sv07-002"
// -> 002) com printedTotal, sem nenhuma chamada de rede - usado nos lugares que só mostram
// um resumo por set (Minha Pasta, grade de eras da Home) e não precisam abrir a lista de
// cartas em si. variantFlagsByCardId aqui é opcional e, quando ausente, a % de "Variações"
// fica 0 (o resumo não busca isso sozinho - ver fetchSetVariantFlags nos lugares que já
// precisam desse dado por outro motivo, como a tela de detalhe do set).
export const getSetTierStatsFromCounts = (
  setSummary: { id: string; printedTotal: number; total: number },
  ownedCards: User['ownedCards'],
  variantFlagsByCardId?: Record<string, CardVariantInfo>
): SetTierStats => {
  const prefix = `${setSummary.id}-`;
  let regularOwned = 0;
  let secretOwned = 0;
  for (const cardId of Object.keys(ownedCards)) {
    if (!cardId.startsWith(prefix) || !isCardOwned(ownedCards, cardId)) continue;
    const localId = parseInt(cardId.slice(prefix.length), 10);
    if (!Number.isNaN(localId) && localId > setSummary.printedTotal) secretOwned += 1;
    else regularOwned += 1;
  }

  const { owned: variationOwned, total: variationTotal } = countVariationSlots(
    variantFlagsByCardId ? Object.keys(variantFlagsByCardId) : [],
    ownedCards,
    variantFlagsByCardId
  );

  const secretTotal = Math.max(0, setSummary.total - setSummary.printedTotal);
  return buildStats(regularOwned, setSummary.printedTotal, secretOwned, secretTotal, variationOwned, variationTotal);
};

export const TIER_COLOR_CLASSES: Record<SetTierColor, { text: string }> = {
  green: { text: 'text-emerald-500' },
  blue: { text: 'text-[#4A90D9]' },
  purple: { text: 'text-[#9B6BD9]' },
};
