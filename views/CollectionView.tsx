
import React, { useState, useEffect, useMemo } from 'react';
import { User, PokemonSet, UserCardData } from '../types';
import { fetchSets } from '../api';
import { getCardTotalQuantity, getCardEstimatedValue } from '../db';

interface CollectionViewProps {
  user: User;
}

const CollectionView: React.FC<CollectionViewProps> = ({ user }) => {
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchSets();
      setSets(data || []);
      setLoading(false);
    };
    loadData();
  }, []);
  
  const calculateStats = (set: PokemonSet) => {
    const ownedIds = Object.keys(user.ownedCards).filter(id => 
      id.startsWith(set.id) && user.ownedCards[id]?.isOwned
    );
    
    const ownedCount = ownedIds.length;
    
    return {
      count: ownedCount,
      total: set.total,
      percentage: set.total > 0 ? (ownedCount / set.total) * 100 : 0
    };
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
    return [...sets].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
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
                      <img src={set.logoUrl} className="max-h-full max-w-full object-contain" />
                   </div>
                   <div>
                     <div className="flex items-center gap-1.5">
                       {set.symbolUrl && <img src={set.symbolUrl} alt="" className="w-3.5 h-3.5 object-contain flex-shrink-0" />}
                       <h3 className="text-sm text-slate-800 uppercase tracking-tight leading-tight">{set.name}</h3>
                     </div>
                     <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">{set.releaseDate}</p>
                   </div>
                </div>
                <div className="text-right">
                  <span className="text-lg text-[#646B99]">{stats.count}</span>
                  <span className="text-slate-300 text-[10px]"> / {stats.total}</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-[#646B99] transition-all duration-1000"
                    style={{ width: `${stats.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                    <p className="text-[8px] text-slate-400 uppercase tracking-widest">
                        {set.series}
                    </p>
                    <p className="text-[10px] text-[#646B99] uppercase tracking-widest">
                        {Math.round(stats.percentage)}% Completo
                    </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CollectionView;
