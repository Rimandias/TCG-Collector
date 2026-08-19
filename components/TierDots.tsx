
import React from 'react';
import { SetTierStats } from '../setProgress';

interface TierDotsProps {
  // null = ainda calculando - mesma convenção do SetProgressBar (mostra bolinhas apagadas em
  // vez de piscar 0% e pular pro valor real).
  stats: SetTierStats | null;
}

// Mesmos 3 nomes já usados nos botões de filtro Base Set/Complete Set/Master Set (HomeView) -
// abreviados aqui por espaço, mas sem inventar tradução nova pra eles.
const TIERS: { label: string; dot: string; text: string; percent: (s: SetTierStats) => number }[] = [
  { label: 'Base', dot: 'bg-emerald-400', text: 'text-emerald-500', percent: s => s.regularPercent },
  { label: 'Complete', dot: 'bg-[#4A90D9]', text: 'text-[#4A90D9]', percent: s => s.secretPercent },
  { label: 'Master', dot: 'bg-[#9B6BD9]', text: 'text-[#9B6BD9]', percent: s => s.variationPercent },
];

// 3 bolinhas (verde/azul/roxa) ao lado da SetProgressBar, cada uma com o nome do tier em cima
// e a % daquele tier especificamente embaixo - a barra já mostra tudo somado numa trilha só,
// isso aqui é o detalhamento por camada num relance, sem precisar abrir o set.
const TierDots: React.FC<TierDotsProps> = ({ stats }) => {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {TIERS.map(tier => {
        const percent = stats ? Math.round(tier.percent(stats)) : null;
        return (
          <div key={tier.label} className="flex flex-col items-center gap-0.5 w-8">
            <span className="text-[6px] uppercase tracking-wide text-slate-400 leading-none">{tier.label}</span>
            <span className={`w-2.5 h-2.5 rounded-full ${percent === null ? 'bg-slate-200 animate-pulse' : tier.dot}`} />
            <span className={`text-[7px] font-bold leading-none ${percent === null ? 'text-slate-300' : tier.text}`}>
              {percent === null ? '--' : `${percent}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default TierDots;
