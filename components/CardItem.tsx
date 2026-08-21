
import React, { useEffect, useRef, useState } from 'react';
import { Card, User, CardCondition } from '../types';
import { updateCardStatus, getCardTotalQuantity, getNormalizedVariations, getCompleteCardNumber, adjustLanguageQuantity, getDefaultVariationType, getCardVariationTypes, ensureVariationSlot } from '../db';
import { fetchCardVariants, peekCachedCardVariants } from '../api';
import CardImage from './CardImage';

export type CardViewMode = 'grid3' | 'grid6' | 'list';

interface CardItemProps {
  card: Card;
  user: User;
  onUpdateUser: (user: User) => void;
  onShowInfo: (card: Card) => void;
  viewMode?: CardViewMode;
}

const CardItem: React.FC<CardItemProps> = ({ card, user, onUpdateUser, onShowInfo, viewMode = 'grid3' }) => {
  const cardData = user.ownedCards[card.id] || {
    isOwned: false,
    isForTrade: false,
    variations: {}
  };

  const totalQuantity = getCardTotalQuantity(cardData.variations);

  // Uma chamada a /api/tcg/card-variants leva ~1s de ida e volta (rede até o Render/
  // Supabase) mesmo já cacheada no servidor - esperar por ela antes de aplicar o toque
  // deixaria a interação visivelmente lenta. Em vez disso, usa o que já se sabe
  // instantaneamente (cache local, se essa carta já foi consultada antes) e, se ainda não
  // souber, aplica o toque como Standard (chute otimista, igual sempre foi) e corrige
  // sozinho em segundo plano assim que a resposta real chegar - sem travar nada.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const reconcileVariation = (guessedVariation: string, quantityGuessed: number, isToggle: boolean) => {
    fetchCardVariants(card.id).then((info) => {
      const correctVariation = getDefaultVariationType(info.flags);
      if (correctVariation === guessedVariation) return;
      const latestUser = userRef.current;
      const latestCardData = latestUser.ownedCards[card.id];
      if (!latestCardData) return;
      const latestNormalized = getNormalizedVariations(latestCardData.variations);
      const guessedNow = ensureVariationSlot(latestNormalized, guessedVariation)[CardCondition.NM].quantity;
      const correctNow = ensureVariationSlot(latestNormalized, correctVariation)[CardCondition.NM].quantity;
      // Só migra se a variação "chutada" ainda tem exatamente o que colocamos lá e a
      // variação certa ainda está zerada - sinal de que nada mais mexeu nessa carta nesse
      // meio-tempo (ex: usuário abriu o +Info e editou manualmente). Se mexeu, não arrisca
      // sobrescrever - o dado fica onde está, só sem a correção automática dessa vez.
      if (guessedNow !== quantityGuessed || correctNow !== 0) return;
      if (getCardTotalQuantity(latestCardData.variations) !== quantityGuessed) return;
      latestNormalized[correctVariation][CardCondition.NM].quantity = quantityGuessed;
      latestNormalized[guessedVariation][CardCondition.NM].quantity = 0;
      onUpdateUser(updateCardStatus(latestUser, card.id, isToggle ? { isOwned: true, variations: latestNormalized } : { variations: latestNormalized }));
    });
  };

  const toggleOwned = () => {
    // Se não tiver nenhuma, ao clicar na carta marcamos como possuída - na variação que a
    // carta realmente tem (nem toda carta tem Standard; ver getDefaultVariationType).
    if (totalQuantity === 0) {
      const cachedInfo = peekCachedCardVariants(card.id);
      const variation = getDefaultVariationType(cachedInfo?.flags);
      const normalized = getNormalizedVariations(cardData.variations);
      ensureVariationSlot(normalized, variation)[CardCondition.NM].quantity = 1;
      onUpdateUser(updateCardStatus(user, card.id, { isOwned: true, variations: normalized }));
      if (!cachedInfo) reconcileVariation(variation, 1, true);
    } else {
      // Se já tem, o clique na carta apenas alterna a visualização (colorida/p&b) via isOwned se solicitado,
      // mas o comportamento padrão solicitado agora vincula a cor ao contador > 0.
      // Para manter a funcionalidade de clique sugerida antes, vamos apenas alternar o isOwned visual.
      onUpdateUser(updateCardStatus(user, card.id, { isOwned: !cardData.isOwned }));
    }
  };

  const adjustQuantity = (delta: number) => {
    const normalized = getNormalizedVariations(cardData.variations);

    if (delta > 0) {
      // Adicionar sempre vai pra variação que a carta realmente tem (getDefaultVariationType) -
      // nem toda carta tem Standard (promos, exclusivas de Pokebola/Master Ball etc.), então
      // cravar sempre nela criaria uma cópia numa variação que a API nunca confirma pra essa
      // carta específica.
      const cachedInfo = peekCachedCardVariants(card.id);
      const variation = getDefaultVariationType(cachedInfo?.flags);
      const nmDetails = ensureVariationSlot(normalized, variation)[CardCondition.NM];
      // Cartas com idioma detalhado (ver +Info) mantêm o total consistente somando/
      // subtraindo no idioma padrão (Português/BR), em vez de mexer direto no agregado.
      if (nmDetails.languages) {
        normalized[variation][CardCondition.NM] = adjustLanguageQuantity(nmDetails, 'BR', delta);
      } else {
        normalized[variation][CardCondition.NM].quantity = (nmDetails.quantity || 0) + delta;
      }
      const hasCards = getCardTotalQuantity(normalized) > 0;
      onUpdateUser(updateCardStatus(user, card.id, { variations: normalized, isOwned: hasCards }));
      if (!cachedInfo) reconcileVariation(variation, normalized[variation][CardCondition.NM].quantity, false);
      return;
    }

    // Remover sempre tira de onde a cópia REALMENTE está, não de onde uma cópia nova entraria
    // (getDefaultVariationType/NM) - a carta pode ter sido registrada numa variação/condição
    // diferente dessa (ex: editada manualmente no +Info numa condição que não NM, cartas
    // adicionadas antes de VARIATION_TYPES bater com a variação real da carta, ou uma variação
    // dinâmica tipo "Friend Ball"/"Energy" que só existe pra essa carta específica). Sem isso,
    // "-" numa carta assim não fazia nada: decrementava um slot vazio (Math.max(0, 0-1) = 0,
    // sem mudança) mesmo com o total mostrando cópias de verdade em outro lugar. Varre
    // variação por variação (tipos-base primeiro, depois qualquer dinâmica que a carta tem -
    // ver getCardVariationTypes) e, dentro de cada uma, condição por condição (NM, SP, MP, HP,
    // D - ordem de CardCondition) até achar a primeira com alguma unidade.
    const cachedInfoForRemoval = peekCachedCardVariants(card.id);
    for (const variation of getCardVariationTypes(cachedInfoForRemoval?.flags)) {
      const slot = normalized[variation];
      if (!slot) continue;
      for (const condition of Object.values(CardCondition)) {
        const details = slot[condition];
        if ((details.quantity || 0) <= 0) continue;
        if (details.languages) {
          slot[condition] = adjustLanguageQuantity(details, 'BR', delta);
        } else {
          slot[condition].quantity = Math.max(0, details.quantity + delta);
        }
        const hasCards = getCardTotalQuantity(normalized) > 0;
        onUpdateUser(updateCardStatus(user, card.id, { variations: normalized, isOwned: hasCards }));
        return;
      }
    }
    // Nada pra remover (já em 0 em toda variação/condição) - não salva à toa.
  };

  // Digitar um número direto no contador (em vez de clicar +/- várias vezes) - mesma regra do
  // "+": sempre define a quantidade na variação que a carta realmente tem (getDefaultVariationType)
  // e condição NM, nunca cria/mexe em outra variação/condição já registrada. Se a carta já tem
  // cópias espalhadas em mais de um lugar, o total exibido passa a ser a soma de tudo (esse
  // slot com o valor novo + o que já existia em outro lugar) - previsível, já que segue a mesma
  // regra usada pelo toque rápido de sempre.
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [draftQuantity, setDraftQuantity] = useState('');

  const startEditingQuantity = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftQuantity(String(totalQuantity));
    setEditingQuantity(true);
  };

  const commitQuantity = () => {
    setEditingQuantity(false);
    const parsed = Math.max(0, Math.floor(Number(draftQuantity)) || 0);
    const cachedInfo = peekCachedCardVariants(card.id);
    const variation = getDefaultVariationType(cachedInfo?.flags);
    const normalized = getNormalizedVariations(cardData.variations);
    const nmDetails = ensureVariationSlot(normalized, variation)[CardCondition.NM];
    if (parsed === nmDetails.quantity) return;
    if (nmDetails.languages) {
      normalized[variation][CardCondition.NM] = adjustLanguageQuantity(nmDetails, 'BR', parsed - nmDetails.quantity);
    } else {
      normalized[variation][CardCondition.NM].quantity = parsed;
    }
    const hasCards = getCardTotalQuantity(normalized) > 0;
    onUpdateUser(updateCardStatus(user, card.id, { variations: normalized, isOwned: hasCards }));
    if (!cachedInfo) reconcileVariation(variation, normalized[variation][CardCondition.NM].quantity, false);
  };

  const isWishlisted = (user.wishlist || []).includes(card.id);

  const toggleWishlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentWishlist = user.wishlist || [];
    const updatedWishlist = currentWishlist.includes(card.id)
      ? currentWishlist.filter(id => id !== card.id)
      : [...currentWishlist, card.id];

    onUpdateUser({
      ...user,
      wishlist: updatedWishlist
    });
  };

  // Regra: se contador for 0, fica P&B. Se for > 0, fica colorido.
  const isColor = totalQuantity > 0;

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-2 shadow-sm animate-in fade-in duration-200">
        <button
          onClick={toggleOwned}
          className={`relative flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${isColor ? 'bg-[#646B99] text-white' : 'bg-slate-100 text-slate-300'}`}
          title={isColor ? 'Possui esta carta' : 'Marcar como possuída'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          {cardData.isForTrade && (
            <span className="absolute -top-1 -left-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white" title="Para troca" />
          )}
          {isWishlisted && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white" title="Na lista de desejos" />
          )}
        </button>

        <button onClick={() => onShowInfo(card)} className="flex-1 min-w-0 text-left">
          <h4 className="text-xs text-slate-700 truncate font-medium">{card.name}</h4>
          <span className="text-[10px] text-slate-400 font-mono">#{getCompleteCardNumber(card)} · {card.rarity}</span>
        </button>

        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden h-8 flex-shrink-0">
          <button
            onClick={() => adjustQuantity(-1)}
            className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
          >
            -
          </button>
          {editingQuantity ? (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              value={draftQuantity}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraftQuantity(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitQuantity}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              className="w-6 text-center text-[11px] text-[#646B99] tabular-nums bg-white border border-[#646B99] rounded outline-none"
            />
          ) : (
            <span
              onClick={startEditingQuantity}
              className="w-6 text-center text-[11px] text-[#646B99] tabular-nums cursor-pointer"
            >
              {totalQuantity}
            </span>
          )}
          <button
            onClick={() => adjustQuantity(1)}
            className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={toggleWishlist}
            className={`p-1.5 rounded-lg transition-all ${isWishlisted ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-300 hover:text-red-500'}`}
            title={isWishlisted ? "Remover da Lista de Desejos" : "Adicionar à Lista de Desejos"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill={isWishlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  const isCompact = viewMode === 'grid6';

  return (
    <div className="flex flex-col gap-2 bg-white animate-in zoom-in-95 duration-200 group mb-4">
      {/* Imagem da Carta */}
      <div
        onClick={toggleOwned}
        className="relative aspect-[2/2.8] overflow-hidden rounded-md cursor-pointer transition-transform active:scale-95 shadow-sm border border-slate-100"
      >
        <CardImage
          src={card.imageUrl}
          alt={card.name}
          className={`w-full h-full object-cover transition-all duration-500 ${isColor ? 'grayscale-0' : 'grayscale brightness-[0.8] opacity-40'} ${!card.imageUrl ? 'bg-slate-100' : ''}`}
        />
        {cardData.isForTrade && (
          <div className="absolute top-1 left-1 w-5 h-5 bg-[#646B99] rounded-full flex items-center justify-center shadow-md border border-white">
             <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
          </div>
        )}
        {isWishlisted && (
          <div className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md border border-white animate-in zoom-in">
             <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
               <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
             </svg>
          </div>
        )}
      </div>

      {/* Controladores (Estilo Pílula) */}
      <div className="flex flex-col gap-2">
        <div className={`flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden shadow-sm ${isCompact ? 'h-7' : 'h-8'}`}>
          {/* Seletor de Quantidade */}
          <div className="flex items-center flex-1 justify-between px-1 border-r border-slate-200 h-full">
            <button
              onClick={(e) => { e.stopPropagation(); adjustQuantity(-1); }}
              className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
            >
              -
            </button>
            {editingQuantity ? (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoFocus
                value={draftQuantity}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraftQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitQuantity}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                className="w-7 text-center text-[11px] text-[#646B99] tabular-nums bg-white border border-[#646B99] rounded outline-none"
              />
            ) : (
              <span
                onClick={startEditingQuantity}
                className="text-[11px] text-[#646B99] tabular-nums cursor-pointer"
              >
                {totalQuantity}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); adjustQuantity(1); }}
              className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors"
            >
              +
            </button>
          </div>

          {/* Botão + Info */}
          <button
            onClick={(e) => { e.stopPropagation(); onShowInfo(card); }}
            className={`flex-[1.2] text-slate-500 tracking-tight h-full hover:bg-slate-100 transition-colors ${isCompact ? 'text-[7px]' : 'text-[9px]'}`}
          >
            + Info
          </button>
        </div>

        {/* Botão de Troca e Nome */}
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col overflow-hidden flex-1" onClick={() => onShowInfo(card)}>
            <h4 className="text-[8px] text-slate-700 truncate uppercase tracking-tight leading-none">{card.name}</h4>
            <span className="text-[7px] text-slate-400 mt-0.5 font-mono">#{getCompleteCardNumber(card)}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={toggleWishlist}
              className={`p-1.5 rounded-lg transition-all ${isWishlisted ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-300 hover:text-red-500'}`}
              title={isWishlisted ? "Remover da Lista de Desejos" : "Adicionar à Lista de Desejos"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill={isWishlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardItem;
