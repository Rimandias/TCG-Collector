
import React from 'react';
import { Deck } from '../types';
import { CardViewMode } from './CardItem';

interface DeckItemProps {
  deck: Deck;
  viewMode?: CardViewMode;
  onDelete: (deckId: string) => void;
}

const DeckItem: React.FC<DeckItemProps> = ({ deck, viewMode = 'grid3', onDelete }) => {
  const cardCount = deck.cardIds.length;
  const cardLabel = cardCount === 1 ? 'carta' : 'cartas';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(deck.id);
  };

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-2 shadow-sm animate-in fade-in duration-200">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[#646B99] text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
        </div>

        <div className="flex-1 min-w-0 text-left">
          <h4 className="text-xs text-slate-700 truncate font-medium">{deck.name}</h4>
          <span className="text-[10px] text-slate-400">{cardCount} {cardLabel}</span>
        </div>

        <button
          onClick={handleDelete}
          className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
          title="Excluir deck"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    );
  }

  const isCompact = viewMode === 'grid6';

  return (
    <div className="flex flex-col gap-2 bg-white animate-in zoom-in-95 duration-200 group mb-4">
      <div className="relative aspect-[2/2.8] overflow-hidden rounded-md shadow-sm border border-slate-100 bg-gradient-to-br from-[#646B99] to-[#4d5275] flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" className={isCompact ? 'w-6 h-6 text-white/70' : 'w-9 h-9 text-white/70'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>

        <button
          onClick={handleDelete}
          className="absolute top-1 right-1 w-5 h-5 bg-black/30 hover:bg-red-500 rounded-full flex items-center justify-center transition-colors"
          title="Excluir deck"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div className="flex flex-col overflow-hidden px-1">
        <h4 className="text-[8px] text-slate-700 truncate uppercase tracking-tight leading-none">{deck.name}</h4>
        <span className="text-[7px] text-slate-400 mt-0.5 font-mono">{cardCount} {cardLabel}</span>
      </div>
    </div>
  );
};

export default DeckItem;
