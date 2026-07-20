
import React from 'react';
import { Card, User, CardCondition } from '../types';
import { updateCardStatus, getCardTotalQuantity, getNormalizedVariations, getCompleteCardNumber, adjustLanguageQuantity } from '../db';

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

  const toggleOwned = () => {
    // Se não tiver nenhuma, ao clicar na carta marcamos como possuída (Foil NM x1)
    if (totalQuantity === 0) {
      const normalized = getNormalizedVariations(cardData.variations);
      normalized['Standard'][CardCondition.NM].quantity = 1;
      onUpdateUser(updateCardStatus(user, card.id, { isOwned: true, variations: normalized }));
    } else {
      // Se já tem, o clique na carta apenas alterna a visualização (colorida/p&b) via isOwned se solicitado,
      // mas o comportamento padrão solicitado agora vincula a cor ao contador > 0.
      // Para manter a funcionalidade de clique sugerida antes, vamos apenas alternar o isOwned visual.
      onUpdateUser(updateCardStatus(user, card.id, { isOwned: !cardData.isOwned }));
    }
  };

  const adjustQuantity = (delta: number) => {
    const normalized = getNormalizedVariations(cardData.variations);
    const nmDetails = normalized['Standard'][CardCondition.NM];
    // Cartas com idioma detalhado (ver +Info) mantêm o total consistente somando/
    // subtraindo no idioma padrão (Português/BR), em vez de mexer direto no agregado.
    if (nmDetails.languages) {
      normalized['Standard'][CardCondition.NM] = adjustLanguageQuantity(nmDetails, 'BR', delta);
    } else {
      const currentNM = nmDetails.quantity || 0;
      normalized['Standard'][CardCondition.NM].quantity = Math.max(0, currentNM + delta);
    }
    const hasCards = getCardTotalQuantity(normalized) > 0;
    onUpdateUser(updateCardStatus(user, card.id, { variations: normalized, isOwned: hasCards }));
  };

  const toggleTrade = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateUser(updateCardStatus(user, card.id, { isForTrade: !cardData.isForTrade }));
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
          <span className="w-6 text-center text-[11px] text-[#646B99] tabular-nums">{totalQuantity}</span>
          <button
            onClick={() => adjustQuantity(1)}
            className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={toggleTrade}
            className={`p-1.5 rounded-lg transition-all ${cardData.isForTrade ? 'bg-[#646B99] text-white' : 'bg-slate-50 text-slate-300 hover:text-[#646B99]'}`}
            title="Adicionar para Trocas"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
          </button>
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
        <img
          src={card.imageUrl}
          alt={card.name}
          className={`w-full h-full object-cover transition-all duration-500 ${isColor ? 'grayscale-0' : 'grayscale brightness-[0.8] opacity-40'}`}
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
            <span className="text-[11px] text-[#646B99] tabular-nums">{totalQuantity}</span>
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
              onClick={toggleTrade}
              className={`p-1.5 rounded-lg transition-all ${cardData.isForTrade ? 'bg-[#646B99] text-white' : 'bg-slate-50 text-slate-300 hover:text-[#646B99]'}`}
              title="Adicionar para Trocas"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
            </button>
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
