import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, PokemonSet, Card, CardCondition } from '../types';
import { fetchJpSets, fetchJpCardsBySet } from '../api';
import CardItem, { CardViewMode } from '../components/CardItem';
import CardViewModeSelector from '../components/CardViewModeSelector';
import CardModal from '../components/CardModal';
import { getCardTotalQuantity, getCompleteCardNumber, getCardEstimatedValue, getNormalizedVariations } from '../db';
import { getInitialCardViewMode, saveCardViewMode, getCardGridClassName } from '../viewMode';

// Rastreador das coleções japonesas (exclusivas do Japão, catalogadas via TCGdex já
// que a Pokemon TCG API só cobre lançamentos ocidentais). Espelha a experiência do
// rastreador ocidental (HomeView), mas é auto-contido: tem sua própria navegação de
// era/coleção e busca local, sem depender do cabeçalho/estado global do App.
interface HomeViewJpProps {
  user: User;
  onUpdateUser: (user: User) => void;
  onBackToWestern: () => void;
}

const BackButton: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button onClick={onClick} className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors">
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    {label}
  </button>
);

const HomeViewJp: React.FC<HomeViewJpProps> = ({ user, onUpdateUser, onBackToWestern }) => {
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<PokemonSet | null>(null);
  const [setCards, setSetCards] = useState<Card[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'tudo' | 'restantes'>('tudo');
  const [infoCard, setInfoCard] = useState<Card | null>(null);
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);

  useEffect(() => {
    saveCardViewMode(viewMode);
  }, [viewMode]);

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJpSets();
      setSets(data || []);
    } catch {
      setError('Não foi possível carregar o catálogo japonês agora.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!selectedSet) return;
    setLoadingCards(true);
    fetchJpCardsBySet(selectedSet.id)
      .then((cards: Card[]) => {
        const sorted = [...cards].sort((a, b) => {
          const numA = parseInt(a.number.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.number.replace(/\D/g, '')) || 0;
          return numA - numB;
        });
        setSetCards(sorted);
      })
      .finally(() => setLoadingCards(false));
  }, [selectedSet]);

  const calculateProgress = useCallback((setId: string, total: number) => {
    const ownedInSet = Object.keys(user.ownedCards).filter(id => id.startsWith(setId) && user.ownedCards[id]?.isOwned).length;
    return total > 0 ? (ownedInSet / total) * 100 : 0;
  }, [user.ownedCards]);

  const eras = useMemo(() => {
    const uniqueSeries: string[] = Array.from(new Set(sets.map(s => s.series)));
    const oldestReleaseDate = (era: string) => {
      const eraSets = sets.filter(s => s.series === era);
      const dates = eraSets.map(s => s.releaseDate).filter(Boolean).sort();
      return dates[0] || '9999-99-99';
    };
    // Mais recente primeiro, igual ao rastreador ocidental.
    return uniqueSeries.sort((a, b) => oldestReleaseDate(b).localeCompare(oldestReleaseDate(a)));
  }, [sets]);

  const filteredEras = useMemo(() => {
    if (!searchQuery.trim()) return eras;
    const q = searchQuery.toLowerCase().trim();
    return eras.filter(era => era.toLowerCase().includes(q));
  }, [eras, searchQuery]);

  const getEraLogo = useCallback((era: string) => {
    const eraSets = sets.filter(s => s.series === era);
    const sorted = [...eraSets].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    return sorted[0]?.logoUrl || '';
  }, [sets]);

  const getEraYear = useCallback((era: string) => {
    const eraSets = sets.filter(s => s.series === era);
    const dates = eraSets.map(s => s.releaseDate).filter(Boolean).sort();
    if (dates.length === 0) return '';
    const startYear = dates[0].split('-')[0];
    const endYear = dates[dates.length - 1].split('-')[0];
    return startYear === endYear ? startYear : `${startYear} — ${endYear}`;
  }, [sets]);

  const setsInSeries = useMemo(() => {
    const base = sets.filter(s => s.series === selectedSeries);
    const sorted = [...base].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase().trim();
    return sorted.filter(s => s.name.toLowerCase().includes(q));
  }, [sets, selectedSeries, searchQuery]);

  const filteredCards = useMemo(() => {
    let base = setCards;
    if (filterTab === 'restantes') {
      base = base.filter(card => {
        const data = user.ownedCards[card.id];
        return !data || getCardTotalQuantity(data.variations) === 0;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      base = base.filter(card => {
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        return card.name.toLowerCase().includes(q) || card.number.toLowerCase().includes(q) || fullNum.includes(q);
      });
    }
    return base;
  }, [setCards, filterTab, searchQuery, user.ownedCards]);

  const setStats = useMemo(() => {
    if (!selectedSet || setCards.length === 0) return null;
    const ownedCardsInSet = setCards.filter(c => {
      const data = user.ownedCards[c.id];
      return data && getCardTotalQuantity(data.variations) > 0;
    });
    const estimatedValue = ownedCardsInSet.reduce((acc, c) => acc + getCardEstimatedValue(user.ownedCards[c.id].variations), 0);
    return {
      totalCards: setCards.length,
      ownedCount: ownedCardsInSet.length,
      value: estimatedValue,
      progress: (ownedCardsInSet.length / setCards.length) * 100,
    };
  }, [selectedSet, setCards, user.ownedCards]);

  const handleSelectAllInSet = () => {
    const updatedOwnedCards = { ...user.ownedCards };
    setCards.forEach(card => {
      const current = updatedOwnedCards[card.id];
      if (current && getCardTotalQuantity(current.variations) > 0) return;
      const normalized = getNormalizedVariations(current?.variations || {});
      normalized['Standard'][CardCondition.NM].quantity = 1;
      updatedOwnedCards[card.id] = { cardId: card.id, isOwned: true, isForTrade: current?.isForTrade || false, variations: normalized };
    });
    onUpdateUser({ ...user, ownedCards: updatedOwnedCards });
  };

  const handleBack = () => {
    if (selectedSet) { setSelectedSet(null); setSearchQuery(''); return; }
    if (selectedSeries) { setSelectedSeries(null); setSearchQuery(''); return; }
    onBackToWestern();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 bg-white min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-xs uppercase tracking-widest">Sincronizando catálogo japonês...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-40 px-8 text-center gap-6 bg-white min-h-[80vh]">
        <p className="text-slate-400 text-xs leading-relaxed">{error}</p>
        <button onClick={init} className="px-8 py-3 bg-[#646B99] text-white text-xs uppercase tracking-widest rounded-full hover:bg-[#4d5275] transition-all shadow-lg">
          Tentar Novamente
        </button>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300 px-4 pb-10 pt-4">
      <div className="flex items-center justify-between mb-4">
        <BackButton onClick={handleBack} label={selectedSet ? 'Coleções' : selectedSeries ? 'Eras' : 'Ocidental'} />
        <span className="text-[9px] text-slate-300 uppercase tracking-widest">Coleções Orientais</span>
      </div>

      <div className="relative mb-4">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input
          type="text"
          placeholder={selectedSet ? `Buscar em ${selectedSet.name}...` : selectedSeries ? `Buscar em ${selectedSeries}...` : 'Buscar era...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-slate-50 border border-slate-100 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-700 outline-none focus:border-[#646B99] transition-all"
        />
      </div>

      {selectedSet ? (
        <>
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {selectedSet.symbolUrl && <img src={selectedSet.symbolUrl} alt="" className="w-3.5 h-3.5 object-contain flex-shrink-0" />}
            <span className="text-sm text-slate-500 text-center font-medium uppercase tracking-wider">
              {selectedSet.releaseDate?.split('-')[0]} — {selectedSet.name}
            </span>
          </div>

          <div className="mb-6">
            <div className="flex gap-2 pb-2">
              <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-1 shadow-sm">
                <span className="text-sm font-semibold text-slate-800">{setStats?.totalCards || selectedSet.total}</span>
                <p className="text-[9px] text-slate-400 uppercase tracking-wide">Cartas</p>
              </div>
              <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-1 shadow-sm">
                <span className="text-sm font-semibold text-[#646B99]">R${setStats?.value.toFixed(2) ?? '0.00'}</span>
                <p className="text-[9px] text-slate-400 uppercase tracking-wide">Valor estimado</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-[#34D399] transition-all duration-700" style={{ width: `${setStats?.progress ?? 0}%` }} />
              </div>
              <span className="text-[11px] text-slate-400">{Math.round(setStats?.progress ?? 0)}%</span>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="flex flex-1 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button onClick={() => setFilterTab('tudo')} className={`flex-1 py-2 rounded-lg text-xs uppercase tracking-widest transition-all ${filterTab === 'tudo' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400'}`}>Tudo</button>
              <button onClick={() => setFilterTab('restantes')} className={`flex-1 py-2 rounded-lg text-xs uppercase tracking-widest transition-all ${filterTab === 'restantes' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400'}`}>Restantes</button>
            </div>
            <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
          </div>

          <div className="mb-4">
            <button onClick={handleSelectAllInSet} className="w-full py-2 bg-[#646B99]/5 border border-[#646B99]/20 text-[#646B99] text-[10px] font-semibold uppercase tracking-widest rounded-xl hover:bg-[#646B99]/10 transition-colors">
              Selecionar Todos (1x Standard NM)
            </button>
          </div>

          <div className={getCardGridClassName(viewMode)}>
            {loadingCards ? (
              [...Array(6)].map((_, i) => <div key={i} className="aspect-[2/2.8] bg-slate-100 animate-pulse rounded-xl" />)
            ) : filteredCards.length === 0 ? (
              <div className="col-span-full py-20 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-widest">Nenhuma carta encontrada</p>
              </div>
            ) : (
              filteredCards.map(card => (
                <CardItem key={card.id} card={card} user={user} onUpdateUser={onUpdateUser} onShowInfo={setInfoCard} viewMode={viewMode} />
              ))
            )}
          </div>
        </>
      ) : selectedSeries ? (
        <div className="grid grid-cols-2 gap-4 px-1">
          {setsInSeries.length === 0 ? (
            <div className="col-span-full py-20 text-center">
              <p className="text-slate-400 text-xs uppercase tracking-widest">Nenhuma coleção encontrada</p>
            </div>
          ) : (
            setsInSeries.map(set => {
              const progress = calculateProgress(set.id, set.total);
              return (
                <button
                  key={set.id}
                  onClick={() => setSelectedSet(set)}
                  className="flex flex-col items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group min-h-[160px]"
                >
                  <div className="h-14 w-full flex items-center justify-center mb-2">
                    <img src={set.logoUrl} className="max-h-full max-w-full object-contain filter group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="w-full space-y-2 mt-auto">
                    <p className="text-[10px] font-medium text-slate-600 text-center line-clamp-1 group-hover:text-[#646B99] transition-colors flex items-center justify-center gap-1">
                      {set.symbolUrl && <img src={set.symbolUrl} alt="" className="w-3 h-3 object-contain flex-shrink-0" />}
                      {set.name}
                    </p>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-500 ${progress > 80 ? 'bg-emerald-400' : progress > 30 ? 'bg-[#646B99]' : 'bg-red-500'}`} style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-[9px] text-slate-400 uppercase text-center">{Math.round(progress)}%</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredEras.map(era => (
            <button
              key={era}
              onClick={() => setSelectedSeries(era)}
              className="w-full flex flex-col items-center justify-between bg-transparent p-5 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group gap-3 min-h-[130px]"
            >
              <div className="h-16 w-full flex items-center justify-center px-4">
                <img src={getEraLogo(era)} alt={era} className="max-h-full max-w-full object-contain filter group-hover:scale-110 transition-all duration-500" />
              </div>
              <div className="text-center">
                <span className="text-[11px] text-slate-600 font-medium tracking-wide">{era}</span>
                <div className="mt-1">
                  <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase bg-slate-50/80 px-2.5 py-1 rounded-full border border-slate-100/60">
                    {getEraYear(era)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {infoCard && (
        <CardModal card={infoCard} user={user} onUpdateUser={onUpdateUser} onClose={() => setInfoCard(null)} />
      )}
    </div>
  );
};

export default HomeViewJp;
