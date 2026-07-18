import React from 'react';
import { CardViewMode } from './CardItem';

interface CardViewModeSelectorProps {
  viewMode: CardViewMode;
  onChange: (mode: CardViewMode) => void;
}

const CardViewModeSelector: React.FC<CardViewModeSelectorProps> = ({ viewMode, onChange }) => {
  const baseBtn = 'p-1.5 rounded-lg transition-colors';
  const activeBtn = 'bg-white text-[#646B99] shadow-sm';
  const inactiveBtn = 'text-slate-400 hover:text-slate-600';

  return (
    <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-100 rounded-xl p-1">
      <button
        type="button"
        onClick={() => onChange('grid3')}
        title="3 colunas"
        className={`${baseBtn} ${viewMode === 'grid3' ? activeBtn : inactiveBtn}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="4" height="18" rx="1" /><rect x="16" y="3" width="5" height="18" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('grid6')}
        title="6 colunas (somente desktop)"
        className={`hidden md:inline-flex ${baseBtn} ${viewMode === 'grid6' ? activeBtn : inactiveBtn}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="2.5" height="18" rx="0.5" /><rect x="6.5" y="3" width="2.5" height="18" rx="0.5" /><rect x="11" y="3" width="2.5" height="18" rx="0.5" /><rect x="15.5" y="3" width="2.5" height="18" rx="0.5" /><rect x="20" y="3" width="2" height="18" rx="0.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        title="Lista, sem imagem"
        className={`${baseBtn} ${viewMode === 'list' ? activeBtn : inactiveBtn}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </button>
    </div>
  );
};

export default CardViewModeSelector;
