import React from 'react';
import { Card, CardCondition } from '../types';
import { getCompleteCardNumber } from '../db';
import CardImage from './CardImage';
import { CardViewMode } from './CardItem';

// Cores fixas por qualidade (mesma regra em qualquer lugar que exiba essas tags - pasta de
// Repetidas, pasta de amigos, futuro link público): NM verde, SP azul, MP amarelo, HP laranja,
// D vermelho. A tag de variação (Standard/Foil/etc.) é sempre roxa, para diferenciar de longe
// das tags de qualidade mesmo em preview compacto (grid-6).
const CONDITION_TAG_CLASSES: Record<string, string> = {
  [CardCondition.NM]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  [CardCondition.SP]: 'bg-blue-100 text-blue-700 border-blue-200',
  [CardCondition.MP]: 'bg-amber-100 text-amber-700 border-amber-200',
  [CardCondition.HP]: 'bg-orange-100 text-orange-700 border-orange-200',
  [CardCondition.D]: 'bg-red-100 text-red-700 border-red-200',
};

const VARIATION_TAG_CLASSES = 'bg-purple-100 text-purple-700 border-purple-200';

export interface VariationSlot {
  card: Card;
  variation: string;
  condition: string;
  quantity: number;
  price: number;
}

interface VariationSlotTileProps {
  slot: VariationSlot;
  viewMode: CardViewMode;
  hidden?: boolean;
  onToggleHidden?: () => void;
  onClick?: () => void;
}

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
);

const Tags: React.FC<{ slot: VariationSlot; size: 'sm' | 'xs' }> = ({ slot, size }) => {
  const cls = size === 'sm' ? 'text-[9px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5';
  return (
    <div className="flex flex-wrap gap-1">
      <span className={`${cls} rounded border font-semibold ${VARIATION_TAG_CLASSES}`}>{slot.variation}</span>
      <span className={`${cls} rounded border font-semibold ${CONDITION_TAG_CLASSES[slot.condition] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{slot.condition}</span>
    </div>
  );
};

// Um "slot" = uma combinação carta+variação+qualidade com quantidade > 0 - o mesmo Pikachu
// com 3 Standard/NM, 2 Standard/D e 1 Foil vira 3 tiles distintos, cada um com sua própria
// quantidade/preço/tags, mesma regra usada pela pasta de amigos (ver FriendFolderBrowser).
const VariationSlotTile: React.FC<VariationSlotTileProps> = ({ slot, viewMode, hidden, onToggleHidden, onClick }) => {
  const { card } = slot;

  if (viewMode === 'list') {
    return (
      <div className={`flex items-center gap-3 bg-white border rounded-xl p-2 shadow-sm transition-opacity ${hidden ? 'border-slate-100 opacity-50' : 'border-slate-100'}`}>
        <CardImage
          src={card.imageUrl}
          alt={card.name}
          onClick={onClick}
          className="w-12 h-16 rounded-lg object-contain bg-slate-50 border border-slate-100/40 flex-shrink-0 cursor-pointer"
        />
        <div className="flex-1 min-w-0" onClick={onClick}>
          <h4 className="text-xs font-semibold text-slate-800 truncate cursor-pointer hover:text-[#646B99] transition-colors">{card.name}</h4>
          <p className="text-[9px] text-slate-400 mb-1">#{getCompleteCardNumber(card)}</p>
          <Tags slot={slot} size="sm" />
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[11px] font-bold text-[#646B99]">{slot.quantity}x</span>
          <span className="text-[10px] font-semibold text-emerald-500">R${slot.price.toFixed(2)}</span>
        </div>
        {onToggleHidden && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
            className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${hidden ? 'text-slate-300 hover:text-[#646B99] hover:bg-[#646B99]/5' : 'text-[#646B99] bg-[#646B99]/10'}`}
            title={hidden ? 'Oculta para outras pessoas (clique para exibir)' : 'Visível para outras pessoas (clique para ocultar)'}
          >
            {hidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    );
  }

  const isCompact = viewMode === 'grid6';

  return (
    <div className={`relative bg-white rounded-xl border p-1.5 flex flex-col items-center gap-1 transition-opacity ${hidden ? 'border-slate-100 opacity-50' : 'border-slate-100'}`}>
      {onToggleHidden && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          className={`absolute top-1 right-1 z-10 p-1 rounded-lg shadow-sm border ${hidden ? 'bg-white/95 text-slate-300 border-slate-100 hover:text-[#646B99]' : 'bg-[#646B99] text-white border-[#646B99]'}`}
          title={hidden ? 'Oculta para outras pessoas (clique para exibir)' : 'Visível para outras pessoas (clique para ocultar)'}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      )}
      <CardImage
        src={card.imageUrl}
        alt={card.name}
        onClick={onClick}
        className="w-full aspect-[5/7] rounded-lg object-contain bg-slate-50 border border-slate-100/40 cursor-pointer"
      />
      <p onClick={onClick} className={`text-slate-700 font-semibold truncate w-full text-center cursor-pointer hover:text-[#646B99] transition-colors ${isCompact ? 'text-[8px]' : 'text-[9px]'}`}>
        {card.name}
      </p>
      <p className="text-[8px] text-slate-400">#{getCompleteCardNumber(card)}</p>
      <Tags slot={slot} size="xs" />
      <div className="flex items-center justify-between w-full">
        <span className="text-[9px] font-bold text-[#646B99]">{slot.quantity}x</span>
        <span className="text-[8px] font-semibold text-emerald-500">R${slot.price.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default VariationSlotTile;
