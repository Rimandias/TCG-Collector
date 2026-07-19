import React from 'react';
import { Card, TradeItem } from '../types';
import { getCompleteCardNumber } from '../db';

// Lista compacta das cartas de uma troca (imagem, nome, variação/condição e quantidade),
// usada nos pop-ups e no histórico para o usuário saber exatamente quais cartas remover/receber fisicamente.
const TradeItemsList: React.FC<{ items: TradeItem[]; cardsById: Record<string, Card> }> = ({ items, cardsById }) => {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
      {items.map((item, idx) => {
        const card = cardsById[item.cardId];
        return (
          <div key={`${item.cardId}-${item.variation}-${item.condition}-${idx}`} className="flex items-center gap-3 p-2 rounded-xl border border-slate-100 bg-slate-50/50">
            {card && (
              <img src={card.imageUrl} className="w-10 h-14 rounded-lg object-contain bg-white border border-slate-100/50 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-slate-700 truncate">{card ? card.name : item.cardId}</p>
              <p className="text-[9px] text-slate-400">
                {card ? `#${getCompleteCardNumber(card)} · ` : ''}{item.variation} · {item.condition} · Qtd: {item.quantity}
              </p>
            </div>
            <span className="text-[10px] font-semibold text-[#646B99] flex-shrink-0">R${(item.quantity * item.unitPrice).toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
};

export default TradeItemsList;
