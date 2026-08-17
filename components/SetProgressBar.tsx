
import React from 'react';
import { SetTierStats, TIER_COLOR_CLASSES } from '../setProgress';

interface SetProgressBarProps {
  // null = ainda calculando (ex: regular/secreta prontos mas variantFlagsByCardId ainda
  // carregando) - mostra um esqueleto em vez de piscar 0% e depois pular pro valor real.
  stats: SetTierStats | null;
  size?: 'sm' | 'md';
  // Esconde o número percentual embaixo da barra - usado nos lugares muito compactos (grade
  // de eras, mini-tiles) onde não há espaço pra também mostrar o texto sem espremer o resto.
  hideLabel?: boolean;
}

const SetProgressBar: React.FC<SetProgressBarProps> = ({ stats, size = 'md', hideLabel = false }) => {
  const height = size === 'sm' ? 'h-1.5' : 'h-2';

  if (!stats) {
    return (
      <div className={`w-full ${height} bg-slate-100 rounded-full overflow-hidden`}>
        <div className={`h-full w-1/4 bg-slate-200 animate-pulse`} />
      </div>
    );
  }

  const colors = TIER_COLOR_CLASSES[stats.tierColor];

  return (
    <div className="w-full space-y-1">
      {/* 3 camadas sobrepostas na mesma trilha (não lado a lado) - cada uma vai de 0 a 100%
          da sua própria fase. Como a fase só avança depois da anterior completar, a de cima
          sempre "cobre" a de baixo por igual ou menos, deixando a cor anterior aparecer por
          trás na parte que a de cima ainda não preencheu (ex: na fase azul, o verde por baixo
          sempre está com 100% de largura). Ordem no DOM = ordem de empilhamento (a última
          pintada por cima). */}
      <div className={`relative w-full ${height} bg-slate-100 rounded-full overflow-hidden`}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-400 transition-all duration-700"
          style={{ width: `${stats.regularPercent}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#4A90D9] transition-all duration-700"
          style={{ width: `${stats.secretPercent}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#9B6BD9] transition-all duration-700"
          style={{ width: `${stats.variationPercent}%` }}
        />
      </div>
      {!hideLabel && (
        <p className={`text-[10px] uppercase tracking-widest font-semibold ${colors.text}`}>
          {Math.round(stats.totalPercent)}%
        </p>
      )}
    </div>
  );
};

export default SetProgressBar;
