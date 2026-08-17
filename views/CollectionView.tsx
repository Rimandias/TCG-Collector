
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, PokemonSet, UserCardData } from '../types';
import { fetchSets, fetchSetVariantFlags, CardVariantInfo } from '../api';
import CardImage from '../components/CardImage';
import SetProgressBar from '../components/SetProgressBar';
import { getCardTotalQuantity, getCardEstimatedValue } from '../db';
import { getSetTierStatsFromCounts } from '../setProgress';

interface CollectionViewProps {
  user: User;
}

const hasAnyOwnedCard = (ownedCards: User['ownedCards'], setId: string): boolean => {
  const prefix = `${setId}-`;
  return Object.keys(ownedCards).some(id => id.startsWith(prefix) && getCardTotalQuantity(ownedCards[id]?.variations) > 0);
};

const CollectionView: React.FC<CollectionViewProps> = ({ user }) => {
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [variantFlagsBySet, setVariantFlagsBySet] = useState<Record<string, Record<string, CardVariantInfo>>>({});
  const requestedSetIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchSets();
      setSets(data || []);
      setLoading(false);
    };
    loadData();
  }, []);

  // Busca as flags de variação (pra % de "Variações" do progresso em camadas) só dos sets
  // que o usuário realmente possui pelo menos uma carta - sets sem nenhuma carta possuída
  // sempre mostram 0%, sem precisar de nenhuma chamada de rede.
  useEffect(() => {
    if (sets.length === 0) return;
    const toFetch = sets
      .filter(set => hasAnyOwnedCard(user.ownedCards, set.id))
      .map(set => set.id)
      .filter(id => !requestedSetIdsRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach(id => requestedSetIdsRef.current.add(id));

    let cancelled = false;
    toFetch.forEach(async (setId) => {
      const flags = await fetchSetVariantFlags(setId);
      if (!cancelled) setVariantFlagsBySet(prev => ({ ...prev, [setId]: flags }));
    });
    return () => {
      cancelled = true;
    };
  }, [sets, user.ownedCards]);

  const calculateStats = (set: PokemonSet) => {
    const stats = getSetTierStatsFromCounts(set, user.ownedCards, variantFlagsBySet[set.id]);
    return { count: stats.regularOwned + stats.secretOwned, tierStats: stats };
  };

  const globalStats = useMemo(() => {
    const ownedCards = Object.values(user.ownedCards) as UserCardData[];
    const totalPhysicalCards = ownedCards.reduce((acc, d) => {
      if (!d.isOwned) return acc;
      return acc + getCardTotalQuantity(d.variations);
    }, 0);
    const totalValue = ownedCards.reduce((acc, d) => {
      if (!d.isOwned) return acc;
      return acc + getCardEstimatedValue(d.variations);
    }, 0);

    return {
      totalOwned: totalPhysicalCards,
      uniqueOwned: ownedCards.filter(d => d.isOwned).length,
      totalValue
    };
  }, [user.ownedCards]);

  const sortedSets = useMemo(() => {
    // Ordem decrescente: coleção mais recente primeiro, igual à Home.
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  }, [sets]);

  const totalCollectibleCards = useMemo(() => {
    return sets.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [sets]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 bg-white min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-xs uppercase tracking-widest">Calculando Estatísticas...</p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 px-6 pb-20 pt-4">
      <div className="mb-10 flex items-end justify-between border-b border-slate-50 pb-6">
        <div>
          <h2 className="text-2xl text-slate-800 tracking-tight leading-none">Minha Pasta</h2>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-2">Status do Mestre Treinador</p>
        </div>
        <div className="text-right">
          <div className="text-3xl text-[#646B99] leading-none">
            {globalStats.uniqueOwned}<span className="text-lg text-slate-300">/{totalCollectibleCards}</span>
          </div>
          <div className="text-[9px] uppercase text-slate-300 tracking-widest mt-1">Cartas Unitárias Colecionadas</div>
          <div className="text-sm text-slate-500 leading-none mt-2">{globalStats.totalOwned}</div>
          <div className="text-[9px] uppercase text-slate-300 tracking-widest mt-1">Total de cartas (com as repetidas)</div>
        </div>
      </div>

      <div className="mb-6 bg-gradient-to-r from-[#646B99] to-[#4d5275] rounded-3xl p-6 shadow-lg">
        <p className="text-[10px] text-white/60 uppercase tracking-widest">Valor Total da Coleção</p>
        <p className="text-3xl text-white font-semibold mt-1">R${globalStats.totalValue.toFixed(2)}</p>
        <p className="text-[9px] text-white/50 mt-1">Soma de todas as coleções, baseada nos preços que você informou</p>
      </div>

      <div className="grid gap-6">
        {sortedSets.map(set => {
          const stats = calculateStats(set);
          if (stats.count === 0) return null;

          return (
            <div key={set.id} className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm transition-all hover:shadow-md">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center p-2 border border-slate-100">
                      <CardImage src={set.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                   </div>
                   <div>
                     <div className="flex items-center gap-1.5">
                       {set.symbolUrl && <CardImage src={set.symbolUrl} alt="" className="w-3.5 h-3.5 object-contain flex-shrink-0" />}
                       <h3 className="text-sm text-slate-800 uppercase tracking-tight leading-tight">{set.name}</h3>
                     </div>
                     <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">{set.releaseDate}</p>
                   </div>
                </div>
                <div className="text-right">
                  <span className="text-lg text-[#646B99]">{stats.count}</span>
                  <span className="text-slate-300 text-[10px]"> / {set.total}</span>
                </div>
              </div>

              <div className="space-y-2">
                <SetProgressBar stats={stats.tierStats} />
                <p className="text-[8px] text-slate-400 uppercase tracking-widest">
                  {set.series}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CollectionView;
