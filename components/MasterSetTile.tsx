
import React from 'react';
import { Card } from '../types';
import { getCompleteCardNumber } from '../db';
import CardImage from './CardImage';
import { CardViewMode } from './CardItem';

interface MasterSetTileProps {
  card: Card;
  variation: string;
  owned: boolean;
  viewMode?: CardViewMode;
}

// Tile somente-leitura do filtro Master Set: cada carta aparece uma vez por variação que a
// TCGdex confirma que ela tem (ver GET /tcg/sets/:id/variant-flags), colorida/P&B conforme o
// usuário tem pelo menos 1 unidade registrada NAQUELA variação específica - não na carta como
// um todo, como o CardItem normal faz. Diferente de CardItem, não edita nada (sem +/-, sem
// trocar/wishlist): é só uma conferência visual de quais variações específicas ainda faltam.
const MasterSetTile: React.FC<MasterSetTileProps> = ({ card, variation, owned, viewMode = 'grid3' }) => {
  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-2 shadow-sm animate-in fade-in duration-200">
        <div className={`relative flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${owned ? 'bg-[#9B6BD9] text-white' : 'bg-slate-100 text-slate-300'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs text-slate-700 truncate font-medium">{card.name}</h4>
          <span className="text-[10px] text-slate-400 font-mono">#{getCompleteCardNumber(card)}</span>
        </div>
        <span className="px-2 py-1 bg-[#9B6BD9]/10 text-[#9B6BD9] text-[9px] font-bold uppercase tracking-wider rounded-full flex-shrink-0">
          {variation}
        </span>
      </div>
    );
  }

  const isCompact = viewMode === 'grid6';

  return (
    <div className="flex flex-col gap-2 bg-white animate-in zoom-in-95 duration-200 mb-4">
      <div className="relative aspect-[2/2.8] overflow-hidden rounded-md shadow-sm border border-slate-100">
        <CardImage
          src={card.imageUrl}
          alt={card.name}
          className={`w-full h-full object-cover transition-all duration-500 ${owned ? 'grayscale-0' : 'grayscale brightness-[0.8] opacity-40'} ${!card.imageUrl ? 'bg-slate-100' : ''}`}
        />
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-[#9B6BD9] text-white text-[7px] font-bold uppercase tracking-wider rounded-full shadow-md">
          {variation}
        </div>
      </div>
      <div className="flex flex-col overflow-hidden px-1">
        <h4 className={`${isCompact ? 'text-[7px]' : 'text-[8px]'} text-slate-700 truncate uppercase tracking-tight leading-none`}>{card.name}</h4>
        <span className="text-[7px] text-slate-400 mt-0.5 font-mono">#{getCompleteCardNumber(card)}</span>
      </div>
    </div>
  );
};

export default MasterSetTile;
