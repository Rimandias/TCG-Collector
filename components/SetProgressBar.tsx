
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

// Barra única (não 3 segmentos separados) porque o total pode passar de 100% (até 300%,
// Base+Complete+Master) - a largura preenchida representa a % do teto de 300%, e a cor
// (verde/azul/roxo) é quem comunica em qual fase a coleção está agora (ver getSetTierStats).
const MAX_TOTAL_PERCENT = 300;

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
  const fillWidth = Math.min(100, (stats.totalPercent / MAX_TOTAL_PERCENT) * 100);

  return (
    <div className="w-full space-y-1">
      <div className={`w-full ${height} bg-slate-100 rounded-full overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      {!hideLabel && (
        <p className={`text-[10px] uppercase tracking-widest font-semibold ${colors.text}`}>
          {Math.round(stats.totalPercent)}% da coleção
        </p>
      )}
    </div>
  );
};

export default SetProgressBar;
