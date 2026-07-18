
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, PokemonSet, Card, UserCardData } from '../types';
import { fetchSets, fetchCardsBySet } from '../api';
import CardItem, { CardViewMode } from '../components/CardItem';
import CardViewModeSelector from '../components/CardViewModeSelector';
import CardModal from '../components/CardModal';
import { getCardTotalQuantity, getCompleteCardNumber, getCardEstimatedValue } from '../db';
import { getInitialCardViewMode, saveCardViewMode, getCardGridClassName } from '../viewMode';

interface HomeViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
  selectedSeries: string | null;
  setSelectedSeries: (series: string | null) => void;
  selectedSet: PokemonSet | null;
  setSelectedSet: (set: PokemonSet | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const HomeView: React.FC<HomeViewProps> = ({ 
  user, 
  onUpdateUser,
  selectedSeries,
  setSelectedSeries,
  selectedSet,
  setSelectedSet,
  searchQuery,
  setSearchQuery
}) => {
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [setCards, setSetCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoCard, setInfoCard] = useState<Card | null>(null);
  const [filterTab, setFilterTab] = useState<'tudo' | 'restantes'>('tudo');
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [loadingAllCards, setLoadingAllCards] = useState(false);
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);

  useEffect(() => {
    saveCardViewMode(viewMode);
  }, [viewMode]);

  const calculateProgress = useCallback((setId: string, total: number) => {
    const ownedInSet = Object.keys(user.ownedCards).filter(id => 
      id.startsWith(setId) && user.ownedCards[id]?.isOwned
    ).length;
    return total > 0 ? (ownedInSet / total) * 100 : 0;
  }, [user.ownedCards]);

  const getSetLogoForSeries = useCallback((seriesName: string) => {
    const logoOverrides: Record<string, string> = {
      'Diamond & Pearl': 'https://images.pokemontcg.io/dp1/logo.png',
      'HeartGold & SoulSilver': 'https://images.pokemontcg.io/hgss1/logo.png',
      'Black & White': 'https://images.pokemontcg.io/bw1/logo.png',
      'XY': 'https://images.pokemontcg.io/xy1/logo.png',
      'Sun & Moon': 'https://images.pokemontcg.io/sm1/logo.png',
      'Sword & Shield': 'https://images.pokemontcg.io/swsh1/logo.png',
      'Scarlet & Violet': 'https://images.pokemontcg.io/sv1/logo.png',
    };

    if (logoOverrides[seriesName]) {
      return logoOverrides[seriesName];
    }

    const seriesSets = sets.filter(s => s.series === seriesName);
    if (seriesSets.length === 0) return '';
    const sorted = [...seriesSets].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    return sorted[0]?.logoUrl || '';
  }, [sets]);

  const getEraYear = useCallback((eraName: string) => {
    const eraSets = sets.filter(s => s.series === eraName);
    if (eraSets.length === 0) return '';
    const dates = eraSets.map(s => s.releaseDate).filter(Boolean).sort();
    const oldestDate = dates[0];
    const newestDate = dates[dates.length - 1];
    if (!oldestDate) return '';
    const startYear = oldestDate.split('-')[0];
    const endYear = newestDate ? newestDate.split('-')[0] : startYear;
    if (startYear === endYear) {
      return startYear;
    }
    return `${startYear} — ${endYear}`;
  }, [sets]);

  const init = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSets();
      if (data === null) {
        setError("Não foi possível conectar ao servidor da Pokémon TCG API. Por favor, verifique sua conexão ou tente novamente mais tarde.");
      } else {
        setSets(data);
      }
    } catch (err) {
      setError("Ocorreu um erro inesperado ao carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (sets.length > 0) {
      const loadAllCards = async () => {
        setLoadingAllCards(true);
        try {
          const all: Card[] = [];
          // Executa em lotes controlados de 5 para não sobrecarregar o navegador e a API,
          // e passa skipBackgroundSync = true para evitar chamadas de background desnecessárias
          const BATCH_SIZE = 5;
          for (let i = 0; i < sets.length; i += BATCH_SIZE) {
            const batch = sets.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
              batch.map(async (s) => {
                try {
                  return await fetchCardsBySet(s.id, true);
                } catch (e) {
                  return [];
                }
              })
            );
            results.forEach(cards => {
              all.push(...cards);
            });
            // Pequena pausa para dar fôlego ao navegador
            if (i + BATCH_SIZE < sets.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
          setAllCards(all);
        } catch (e) {
          console.warn("Error loading all cards for search (falling back gracefully):", e);
        } finally {
          setLoadingAllCards(false);
        }
      };
      loadAllCards();
    }
  }, [sets]);

  useEffect(() => {
    if (selectedSet) {
      const loadCards = async () => {
        setLoadingCards(true);
        try {
          const cards = await fetchCardsBySet(selectedSet.id);
          const sortedCards = cards.sort((a, b) => {
            const numA = parseInt(a.number.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.number.replace(/\D/g, '')) || 0;
            return numA - numB;
          });
          setSetCards(sortedCards);
        } catch (err) {
          console.warn("Error loading cards (using fallback):", err);
        } finally {
          setLoadingCards(false);
        }
      };
      loadCards();
    }
  }, [selectedSet]);

  const eras = useMemo(() => {
    const uniqueSeries: string[] = Array.from(new Set(sets.map(s => s.series)));

    // Helper to get the oldest release date of an era
    const getEraOldestReleaseDate = (eraName: string) => {
      const eraSets = sets.filter(s => s.series === eraName);
      if (eraSets.length === 0) return '9999-99-99';
      const dates = eraSets.map(s => s.releaseDate).sort();
      return dates[0];
    };

    return uniqueSeries.sort((a, b) => {
      const dateA = getEraOldestReleaseDate(a);
      const dateB = getEraOldestReleaseDate(b);
      return dateA.localeCompare(dateB);
    });
  }, [sets]);

  const getEraStyle = useCallback((eraName: string) => {
    const index = eras.indexOf(eraName);
    const safeIndex = index >= 0 ? index : 0;
    
    // 0: Vermelho, 1: Azul com vermelho, 2: Preto com amarelo, 3: Roxo com rosa
    const styles = [
      { bg: 'bg-red-600', dotBg: 'bg-red-500' },
      { bg: 'bg-blue-600', dotBg: 'bg-red-500' },
      { bg: 'bg-zinc-950', dotBg: 'bg-yellow-400' },
      { bg: 'bg-purple-600', dotBg: 'bg-pink-500' },
    ];
    
    return styles[safeIndex % styles.length];
  }, [eras]);

  const setsInSeries = useMemo(() => {
    return sets
      .filter(s => s.series === selectedSeries)
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  }, [sets, selectedSeries]);

  const filteredCards = useMemo(() => {
    let base = setCards;
    if (filterTab === 'restantes') {
      base = setCards.filter(card => {
        const cardData = user.ownedCards[card.id];
        if (!cardData) return true;
        const totalQty = getCardTotalQuantity(cardData.variations);
        return totalQty === 0;
      });
    }

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      base = base.filter(card => {
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        const matchesName = card.name.toLowerCase().includes(q);
        const matchesNum = card.number.toLowerCase() === q || fullNum === q || card.number.toLowerCase().includes(q) || fullNum.includes(q);
        const matchesSet = card.set.name.toLowerCase().includes(q);
        return matchesName || matchesNum || matchesSet;
      });
    }

    return base;
  }, [setCards, filterTab, searchQuery, user.ownedCards]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    let base = allCards;
    if (selectedSeries && !selectedSet) {
      base = allCards.filter(card => {
        const foundSet = sets.find(s => s.id === card.set?.id);
        return foundSet?.series === selectedSeries;
      });
    }
    return base.filter(card => {
      const fullNum = getCompleteCardNumber(card).toLowerCase();
      const matchesName = card.name.toLowerCase().includes(q);
      const matchesNum = card.number.toLowerCase() === q || fullNum === q || card.number.toLowerCase().includes(q) || fullNum.includes(q);
      const matchesSet = card.set?.name?.toLowerCase().includes(q);
      return matchesName || matchesNum || matchesSet;
    });
  }, [allCards, searchQuery, selectedSeries, selectedSet, sets]);

  const setStats = useMemo(() => {
    if (!selectedSet || setCards.length === 0) return null;
    
    const secretCards = setCards.filter(c => c.isSecret);
    const ownedCardsInSet = setCards.filter(c => {
      const userData = user.ownedCards[c.id];
      if (!userData) return false;
      const totalQty = getCardTotalQuantity(userData.variations);
      return totalQty > 0;
    });
    
    const estimatedValue = ownedCardsInSet.reduce((acc, card) => {
      const userData = user.ownedCards[card.id];
      return acc + getCardEstimatedValue(userData.variations);
    }, 0);

    return {
      totalCards: setCards.length,
      secretCount: secretCards.length,
      ownedCount: ownedCardsInSet.length,
      value: estimatedValue,
      progress: (ownedCardsInSet.length / setCards.length) * 100
    };
  }, [selectedSet, setCards, user.ownedCards]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 bg-white min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-xs uppercase tracking-widest">Sincronizando...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-40 px-8 text-center gap-6 bg-white min-h-[80vh]">
        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        </div>
        <div className="space-y-2">
          <h3 className="text-slate-800 text-sm uppercase tracking-widest">Erro de Conexão</h3>
          <p className="text-slate-400 text-xs leading-relaxed">{error}</p>
        </div>
        <button 
          onClick={init}
          className="px-8 py-3 bg-[#646B99] text-white text-xs uppercase tracking-widest rounded-full hover:bg-[#4d5275] transition-all shadow-lg"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  const PokeballDivider = () => (
    <div className="relative w-full h-12 flex items-center justify-center z-10 -mb-6">
       <div className="absolute inset-0 flex items-center">
         <div className="w-full h-[6px] bg-slate-950"></div>
       </div>
       <div className="relative w-12 h-12 rounded-full border-[5px] border-slate-950 bg-white flex items-center justify-center shadow-lg">
          <div className="w-4 h-4 rounded-full border-[2.5px] border-slate-950 bg-white"></div>
       </div>
    </div>
  );

  const renderPokeballBottomBg = (eraName: string) => {
    const index = eras.indexOf(eraName);
    const styleIndex = index >= 0 ? index % 4 : 0;
    
    switch (styleIndex) {
      case 0: // Red Poke Ball
        return (
          <div className="w-full h-full bg-[#EF232F] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
          </div>
        );
      case 1: // Great Ball
        return (
          <div className="w-full h-full bg-[#0048FF] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
            {/* Red angular patches exactly like Great Ball */}
            <div className="absolute bottom-[-2vh] left-[-4vw] w-[35%] h-[12vh] bg-[#EF232F] rotate-45 transform origin-bottom-left rounded-sm shadow-md"></div>
            <div className="absolute bottom-[-2vh] right-[-4vw] w-[35%] h-[12vh] bg-[#EF232F] -rotate-45 transform origin-bottom-right rounded-sm shadow-md"></div>
          </div>
        );
      case 2: // Ultra Ball
        return (
          <div className="w-full h-full bg-[#313131] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
            {/* Yellow rectangular patches in corners */}
            <div className="absolute bottom-0 left-0 w-[24%] h-[75%] bg-[#FFCC00] rounded-tr-xl shadow-md"></div>
            <div className="absolute bottom-0 right-0 w-[24%] h-[75%] bg-[#FFCC00] rounded-tl-xl shadow-md"></div>
          </div>
        );
      case 3: // Master Ball
        return (
          <div className="w-full h-full bg-[#9B42D5] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none"></div>
            {/* Pink circular arcs in the bottom corners */}
            <div className="absolute bottom-[-6vh] left-[-6vw] w-[45vw] h-[45vw] max-w-[180px] max-h-[180px] rounded-full bg-[#E5489B] shadow-md"></div>
            <div className="absolute bottom-[-6vh] right-[-6vw] w-[45vw] h-[45vw] max-w-[180px] max-h-[180px] rounded-full bg-[#E5489B] shadow-md"></div>
          </div>
        );
      default:
        return <div className="w-full h-full bg-[#EF232F]"></div>;
    }
  };

  if (selectedSet) {
    return (
      <div className="animate-in slide-in-from-right duration-300 px-4 pb-10">
        <div className="flex items-center justify-center mb-6">
            <span className="text-sm text-slate-500 text-center font-medium uppercase tracking-wider">
                {selectedSet.releaseDate.split('-')[0]} — {selectedSet.name}
            </span>
        </div>

        <div className="mb-8">
          <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
             <div className="flex-1 min-w-[85px] bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-2 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-slate-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18 3 14 7 10"/><path d="M17 10 21 14 17 18"/><rect width="10" height="14" x="7" y="5" rx="2"/></svg>
                <p className="text-[10px] text-slate-400">{setStats?.totalCards || selectedSet.total} cartas</p>
             </div>
             <div className="flex-1 min-w-[85px] bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-2 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                <p className="text-[10px] text-slate-400">{setStats?.secretCount ?? 0} secretas</p>
             </div>
             <div className="flex-1 min-w-[85px] bg-white p-3 rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-2 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <div className="flex flex-col items-center">
                    <p className="text-[9px] text-slate-400 leading-tight">Valor estimado</p>
                    <p className="text-[10px] text-[#646B99]">R${setStats?.value.toFixed(2) ?? '0.00'}</p>
                </div>
             </div>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-[#34D399] transition-all duration-700" 
                 style={{ width: `${setStats?.progress ?? 0}%` }}
               />
            </div>
            <span className="text-[11px] text-slate-400">{Math.round(setStats?.progress ?? 0)}%</span>
          </div>
        </div>

        {/* Abas de Filtro */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex flex-1 bg-slate-50 p-1 rounded-xl border border-slate-100">
            <button
              onClick={() => setFilterTab('tudo')}
              className={`flex-1 py-2 rounded-lg text-xs uppercase tracking-widest transition-all ${filterTab === 'tudo' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400'}`}
            >
              Tudo
            </button>
            <button
              onClick={() => setFilterTab('restantes')}
              className={`flex-1 py-2 rounded-lg text-xs uppercase tracking-widest transition-all ${filterTab === 'restantes' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400'}`}
            >
              Restantes
            </button>
          </div>
          <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
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
              <CardItem
                key={card.id}
                card={card}
                user={user}
                onUpdateUser={onUpdateUser}
                onShowInfo={setInfoCard}
                viewMode={viewMode}
              />
            ))
          )}
        </div>

        {infoCard && (
          <CardModal 
            card={infoCard} 
            user={user} 
            onUpdateUser={onUpdateUser} 
            onClose={() => setInfoCard(null)} 
          />
        )}
      </div>
    );
  }

  if (selectedSeries) {
    return (
      <div className="relative flex flex-col bg-transparent animate-in slide-in-from-right duration-300 pb-10">
        {/* Fixed Background Layer */}
        <div className="fixed inset-x-0 bottom-0 h-[50vh] pointer-events-none z-0 flex flex-col justify-end">
          <PokeballDivider />
          <div className="w-full flex-1 overflow-hidden relative">
              {renderPokeballBottomBg(selectedSeries)}
              <div className="absolute inset-x-0 bottom-10 flex items-center justify-center">
                <p className="text-white/20 text-6xl font-black uppercase tracking-tighter opacity-10 select-none text-center">
                    {selectedSeries}
                </p>
              </div>
          </div>
        </div>

        {/* Scrollable Content Layer */}
        <div className="relative z-10 px-4 pb-4">
            <div className="flex items-center justify-center mb-6">
                <span className="text-xs text-slate-500 uppercase tracking-[0.2em] font-semibold">{selectedSeries}</span>
            </div>
           
           {searchQuery.trim() !== '' ? (
             <div className="space-y-4">
               <div className="flex items-center justify-between border-b border-slate-100 pb-2 gap-2">
                 <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                   Cartas encontradas ({searchResults.length})
                 </h3>
                 <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
               </div>

               {searchResults.length === 0 ? (
                 <div className="py-20 text-center bg-white/80 rounded-2xl border border-slate-100">
                   <p className="text-slate-400 text-xs uppercase tracking-widest">Nenhuma carta encontrada nesta era</p>
                 </div>
               ) : (
                 <div className={`${getCardGridClassName(viewMode)} bg-white/80 p-3 rounded-2xl border border-slate-100`}>
                   {searchResults.map(card => (
                     <CardItem
                       key={card.id}
                       card={card}
                       user={user}
                       onUpdateUser={onUpdateUser}
                       onShowInfo={setInfoCard}
                       viewMode={viewMode}
                     />
                   ))}
                 </div>
               )}
             </div>
           ) : (
             <div className="grid grid-cols-2 gap-4 px-2">
             {setsInSeries.map(set => {
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
                        <p className="text-[10px] font-medium text-slate-600 text-center line-clamp-1 group-hover:text-[#646B99] transition-colors">
                            {set.name}
                        </p>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                           <div 
                             className={`h-full transition-all duration-500 ${progress > 80 ? 'bg-emerald-400' : progress > 30 ? 'bg-[#646B99]' : 'bg-red-500'}`}
                             style={{ width: `${progress}%` }} 
                           />
                        </div>
                        <p className="text-[9px] text-slate-400 uppercase text-center">{Math.round(progress)}%</p>
                    </div>
                  </button>
                );
             })}
           </div>
          )}
        </div>

        {infoCard && (
          <CardModal
            card={infoCard}
            user={user}
            onUpdateUser={onUpdateUser}
            onClose={() => setInfoCard(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="bg-white px-8 pb-10 flex flex-col items-center gap-6 animate-in fade-in duration-500">
      {searchQuery.trim() !== '' ? (
        // Se houver pesquisa, exibe os resultados globais de busca
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 gap-2">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Resultados da Pesquisa ({searchResults.length})
            </h3>
            <div className="flex items-center gap-2">
              {loadingAllCards && (
                <span className="text-[10px] text-slate-400 animate-pulse">Carregando banco...</span>
              )}
              <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>

          {searchResults.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-slate-400 text-xs uppercase tracking-widest">Nenhuma carta encontrada</p>
            </div>
          ) : (
            <div className={getCardGridClassName(viewMode)}>
              {searchResults.map(card => (
                <CardItem
                  key={card.id}
                  card={card}
                  user={user}
                  onUpdateUser={onUpdateUser}
                  onShowInfo={setInfoCard}
                  viewMode={viewMode}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // Se não houver pesquisa, mostra a seleção normal de Eras
        <>
          <div className="text-center mt-2">
              <p className="text-[10px] text-slate-300 uppercase tracking-[0.3em] mb-4">Selecione a Era</p>
          </div>

          <div className="w-full flex flex-col gap-4">
            {eras.map(era => (
              <button
                key={era}
                onClick={() => setSelectedSeries(era)}
                className="w-full flex flex-col items-center justify-between bg-transparent p-5 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group gap-3 min-h-[130px]"
              >
                <div className="h-16 w-full flex items-center justify-center px-4">
                    <img 
                        src={getSetLogoForSeries(era)} 
                        alt={era} 
                        className="max-h-full max-w-full object-contain filter group-hover:scale-110 transition-all duration-500" 
                    />
                </div>
                <div className="text-center">
                    <span className="text-[10px] text-slate-400 font-medium tracking-wider uppercase bg-slate-50/80 px-2.5 py-1 rounded-full border border-slate-100/60">
                        {getEraYear(era)}
                    </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {infoCard && (
        <CardModal
          card={infoCard}
          user={user}
          onUpdateUser={onUpdateUser}
          onClose={() => setInfoCard(null)}
        />
      )}
    </div>
  );
};

export default HomeView;
