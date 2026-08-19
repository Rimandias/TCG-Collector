
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, PokemonSet, UserCardData } from '../types';
import { fetchSets, fetchSetVariantFlags, CardVariantInfo } from '../api';
import CardImage from '../components/CardImage';
import SetProgressBar from '../components/SetProgressBar';
import TierDots from '../components/TierDots';
import { getCardTotalQuantity, getCardEstimatedValue } from '../db';
import { getSetTierStatsFromCounts, aggregateSetTierStats } from '../setProgress';

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
  // Só a era clicada abre - por padrão tudo fechado, já que ter cartas de várias eras ao
  // mesmo tempo deixava a tela cheia de cards de sets difícil de navegar (era só uma lista
  // achatada de todo set possuído, sem nenhum agrupamento).
  const [expandedEras, setExpandedEras] = useState<Set<string>>(new Set());

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

  const totalCollectibleCards = useMemo(() => {
    return sets.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [sets]);

  // Agrupa só os sets já possuídos (mesmo filtro que a lista antiga usava, count === 0 nunca
  // aparecia) por era, cada grupo já ordenado do set mais recente pro mais antigo. A ordem
  // das eras segue a mesma convenção da Home: era mais recente primeiro, por data de
  // lançamento mais antiga dentro dela.
  const eraGroups = useMemo(() => {
    const ownedSets = sets
      .filter(set => calculateStats(set).count > 0)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

    const bySeries = new Map<string, PokemonSet[]>();
    ownedSets.forEach(set => {
      const list = bySeries.get(set.series) || [];
      list.push(set);
      bySeries.set(set.series, list);
    });

    return Array.from(bySeries.entries())
      .map(([series, setsInEra]) => ({
        series,
        sets: setsInEra,
        tierStats: aggregateSetTierStats(setsInEra.map(set => calculateStats(set).tierStats)),
        oldestReleaseDate: setsInEra.reduce((oldest, s) => (s.releaseDate < oldest ? s.releaseDate : oldest), setsInEra[0].releaseDate),
      }))
      .sort((a, b) => b.oldestReleaseDate.localeCompare(a.oldestReleaseDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, user.ownedCards, variantFlagsBySet]);

  const toggleEra = (series: string) => {
    setExpandedEras(prev => {
      const next = new Set(prev);
      if (next.has(series)) next.delete(series);
      else next.add(series);
      return next;
    });
  };

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

      <div className="grid gap-4">
        {eraGroups.map(({ series, sets: setsInEra, tierStats }) => {
          const isOpen = expandedEras.has(series);
          return (
            <div key={series} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleEra(series)}
                className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-slate-50/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm text-slate-800 uppercase tracking-tight">{series}</h3>
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest">
                      {setsInEra.length} {setsInEra.length === 1 ? 'coleção' : 'coleções'}
                    </span>
                  </div>
                  <div className="mt-2 max-w-xs">
                    <SetProgressBar stats={tierStats} size="sm" />
                  </div>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={`w-4 h-4 text-slate-300 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 space-y-4 border-t border-slate-50 pt-4 animate-in fade-in slide-in-from-top-1 duration-200">
                  {setsInEra.map(set => {
                    const stats = calculateStats(set);
                    return (
                      <div key={set.id} className="bg-slate-50/60 rounded-2xl p-4 border border-slate-100/70">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center p-1.5 border border-slate-100">
                              <CardImage src={set.logoUrl} alt="" className="max-h-full max-w-full object-contain" fallback="empty" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                {set.symbolUrl && <CardImage src={set.symbolUrl} alt="" className="w-3 h-3 object-contain flex-shrink-0" fallback="empty" />}
                                <h4 className="text-xs text-slate-800 uppercase tracking-tight leading-tight">{set.name}</h4>
                              </div>
                              <p className="text-[8px] text-slate-400 uppercase tracking-widest mt-0.5">{set.releaseDate}</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-sm text-[#646B99]">{stats.count}</span>
                            <span className="text-slate-300 text-[10px]"> / {set.total}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <SetProgressBar stats={stats.tierStats} size="sm" />
                          </div>
                          <TierDots stats={stats.tierStats} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CollectionView;
