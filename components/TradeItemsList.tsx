import React from 'react';
import { Card, LANGUAGE_OPTIONS, TradeItem } from '../types';
import { getCompleteCardNumber } from '../db';

const languageLabel = (code?: string) => (!code ? null : (LANGUAGE_OPTIONS.find(l => l.code === code)?.label || code));

// Lista compacta das cartas de uma troca (imagem, nome, variação/condição, idioma e quantidade),
// usada nos pop-ups e no histórico para o usuário saber exatamente quais cartas remover/receber fisicamente.
// Quando onRemoveItem é passado, cada linha ganha um botão para tirar a carta da negociação
// (ex: o usuário só viu a condição real da carta física depois de selecioná-la).
const TradeItemsList: React.FC<{
  items: TradeItem[];
  cardsById: Record<string, Card>;
  onRemoveItem?: (index: number) => void;
  removeDisabled?: boolean;
}> = ({ items, cardsById, onRemoveItem, removeDisabled }) => {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
      {items.map((item, idx) => {
        const card = cardsById[item.cardId];
        const langLabel = languageLabel(item.language);
        const isUnavailable = item.available === false;
        return (
          <div
            key={`${item.cardId}-${item.variation}-${item.condition}-${item.language || ''}-${idx}`}
            className={`flex items-center gap-3 p-2 rounded-xl border ${isUnavailable ? 'border-red-100 bg-red-50/50' : 'border-slate-100 bg-slate-50/50'}`}
          >
            {card && (
              <img src={card.imageUrl} className={`w-10 h-14 rounded-lg object-contain bg-white border border-slate-100/50 flex-shrink-0 ${isUnavailable ? 'opacity-40 grayscale' : ''}`} />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-semibold truncate ${isUnavailable ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{card ? card.name : item.cardId}</p>
              <p className="text-[9px] text-slate-400">
                {card ? `#${getCompleteCardNumber(card)} · ` : ''}{item.variation} · {item.condition}{langLabel ? ` · ${langLabel}` : ''} · Qtd: {item.quantity}
              </p>
              {isUnavailable && (
                <p className="text-[9px] font-semibold text-red-500 mt-0.5">Não está mais disponível — excluída da troca</p>
              )}
            </div>
            <span className={`text-[10px] font-semibold flex-shrink-0 ${isUnavailable ? 'text-slate-300 line-through' : 'text-[#646B99]'}`}>R${(item.quantity * item.unitPrice).toFixed(2)}</span>
            {onRemoveItem && (
              <button
                onClick={() => onRemoveItem(idx)}
                disabled={removeDisabled}
                title="Remover essa carta da negociação"
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TradeItemsList;
