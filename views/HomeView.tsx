
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, PokemonSet, Card, UserCardData, CardCondition, VARIATION_TYPES } from '../types';
import { fetchSets, fetchCardsBySet, searchCards, fetchSetVariantFlags, CardVariantInfo } from '../api';
import CardItem, { CardViewMode } from '../components/CardItem';
import CardImage from '../components/CardImage';
import CardViewModeSelector from '../components/CardViewModeSelector';
import CardModal from '../components/CardModal';
import SetProgressBar from '../components/SetProgressBar';
import MasterSetTile from '../components/MasterSetTile';
import { getCardTotalQuantity, getCompleteCardNumber, getCardEstimatedValue, getNormalizedVariations, getVariationSubtotal } from '../db';
import { getInitialCardViewMode, saveCardViewMode, getCardGridClassName } from '../viewMode';
import { getSetTierStats, getSetTierStatsFromCounts } from '../setProgress';

type SetTierFilter = 'base' | 'complete' | 'master';

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

// Coleção que representa cada era na Home (usada pro logo mostrado no card da era).
// Por id da TCGdex, que é estável - o nome dessas coleções vem traduzido e nem sempre
// bate mais com o nome da era em inglês (ver getSetLogoForSeries).
const ERA_FLAGSHIP_SET_ID: Record<string, string> = {
  'Mega Evolution': 'me01',
  'Scarlet & Violet': 'sv01',
  'Sword & Shield': 'swsh1',
  'Sun & Moon': 'sm1',
  'XY': 'xy1',
  'Black & White': 'bw1',
  'HeartGold & SoulSilver': 'hgss1',
  'Platinum': 'pl1',
  'Diamond & Pearl': 'dp1',
  'POP': 'pop1',
  'EX': 'ex1',
  'E-Card': 'ecard1',
  'Neo': 'neo1',
  'Gym': 'gym1',
  'Base': 'base1',
};

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
  const [setVariantFlags, setSetVariantFlags] = useState<Record<string, CardVariantInfo>>({});
  const [loading, setLoading] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoCard, setInfoCard] = useState<Card | null>(null);
  const [filterTab, setFilterTab] = useState<'tudo' | 'restantes'>('tudo');
  // 'complete' é o padrão: todas as cartas do set (regulares + secretas), igual à visão de
  // sempre. 'base' esconde as secretas. 'master' explode cada carta em uma cópia por
  // variação que a TCGdex confirma que ela tem (ver masterEntries) e não é editável.
  const [setTierFilter, setSetTierFilter] = useState<SetTierFilter>('complete');
  const [globalSearchResults, setGlobalSearchResults] = useState<Card[]>([]);
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);

  useEffect(() => {
    saveCardViewMode(viewMode);
  }, [viewMode]);

  const getSetLogoForSeries = useCallback((seriesName: string) => {
    const seriesSets = sets.filter(s => s.series === seriesName);
    if (seriesSets.length === 0) return '';
    // Coleção-carro-chefe de cada era, por id (estável) - o nome da coleção-base vem
    // traduzido pela TCGdex (ex.: "HeartGold SoulSilver", sem "&") e não bate mais
    // literalmente com o nome da era em inglês que o app usa há mais tempo, então
    // comparar por nome (como antes) parava de funcionar assim que a tradução chegou.
    const flagshipId = ERA_FLAGSHIP_SET_ID[seriesName];
    const flagshipSet = flagshipId && seriesSets.find(s => s.id === flagshipId);
    if (flagshipSet) return flagshipSet.logoUrl || '';
    // Era sem carro-chefe mapeado (ou o set não veio nessa carga): cai pro nome exato
    // e, por fim, pra coleção mais antiga por data de lançamento.
    const baseSet = seriesSets.find(s => s.name.trim().toLowerCase() === seriesName.trim().toLowerCase());
    if (baseSet) return baseSet.logoUrl || '';
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

  // Busca global: consulta o backend (uma única query rápida sobre todas as coleções já
  // cacheadas) em vez de baixar o catálogo inteiro (~200 coleções) para filtrar localmente —
  // essa era a causa real da lentidão do campo de busca. Debounce de 300ms para não disparar
  // uma requisição a cada tecla digitada.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGlobalSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearchingGlobal(true);
      searchCards(q)
        .then((results) => {
          if (!cancelled) setGlobalSearchResults(results);
        })
        .finally(() => {
          if (!cancelled) setSearchingGlobal(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

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

  // Flags de variação de todas as cartas do set (pra % de "Variações" do progresso em
  // camadas e pro filtro Master Set) - busca em lote, separada da carga das cartas em si,
  // pra não atrasar a exibição da grade enquanto isso ainda está chegando.
  useEffect(() => {
    if (!selectedSet) {
      setSetVariantFlags({});
      return;
    }
    let cancelled = false;
    setSetVariantFlags({});
    fetchSetVariantFlags(selectedSet.id).then((flags) => {
      if (!cancelled) setSetVariantFlags(flags);
    });
    return () => {
      cancelled = true;
    };
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

    // Ordem decrescente: era mais recente (ex.: Mega Evolution) primeiro, Base Set por último.
    return uniqueSeries.sort((a, b) => {
      const dateA = getEraOldestReleaseDate(a);
      const dateB = getEraOldestReleaseDate(b);
      return dateB.localeCompare(dateA);
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
    let base = setTierFilter === 'base' ? setCards.filter(c => !c.isSecret) : setCards;
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
        const matchesArtist = (card.artist || '').toLowerCase().includes(q);
        return matchesName || matchesNum || matchesSet || matchesArtist;
      });
    }

    return base;
  }, [setCards, setTierFilter, filterTab, searchQuery, user.ownedCards]);

  // Master Set: cada carta vira uma entrada por variação que a TCGdex confirma que ela tem
  // (setVariantFlags, ver GET /tcg/sets/:id/variant-flags) - cartas sem esse dado ainda
  // carregado ficam de fora até a resposta chegar, em vez de "piscar" sem nenhuma tag. Segue
  // os mesmos filtros de Restantes/busca que a visão normal, só que por variação: "Restantes"
  // aqui é a variação específica ainda não possuída, não a carta como um todo.
  interface MasterEntry {
    card: Card;
    variation: string;
    owned: boolean;
  }
  const masterEntries = useMemo((): MasterEntry[] => {
    if (setTierFilter !== 'master') return [];
    const q = searchQuery.toLowerCase().trim();
    const entries: MasterEntry[] = [];
    for (const card of setCards) {
      if (q) {
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        const matches = card.name.toLowerCase().includes(q) || card.number.toLowerCase().includes(q) || fullNum.includes(q) || (card.artist || '').toLowerCase().includes(q);
        if (!matches) continue;
      }
      const flags = setVariantFlags[card.id]?.flags;
      if (!flags) continue;
      const normalized = getNormalizedVariations(user.ownedCards[card.id]?.variations || {});
      for (const variation of VARIATION_TYPES) {
        if (flags[variation] !== true) continue;
        const owned = getVariationSubtotal(normalized[variation]) > 0;
        if (filterTab === 'restantes' && owned) continue;
        entries.push({ card, variation, owned });
      }
    }
    return entries;
  }, [setTierFilter, setCards, setVariantFlags, user.ownedCards, filterTab, searchQuery]);

  // Marca de uma vez todas as cartas da coleção atual que ainda não são possuídas como
  // 1x Standard NM (mesmo padrão do toque individual), sem sobrescrever cartas já possuídas.
  const handleSelectAllInSet = () => {
    const updatedOwnedCards = { ...user.ownedCards };
    setCards.forEach(card => {
      const current = updatedOwnedCards[card.id];
      const alreadyOwned = current && getCardTotalQuantity(current.variations) > 0;
      if (alreadyOwned) return;
      const normalized = getNormalizedVariations(current?.variations || {});
      normalized['Standard'][CardCondition.NM].quantity = 1;
      updatedOwnedCards[card.id] = {
        cardId: card.id,
        isOwned: true,
        isForTrade: current?.isForTrade || false,
        variations: normalized,
      };
    });
    onUpdateUser({ ...user, ownedCards: updatedOwnedCards });
  };

  // Marca todas as cartas já possuídas da coleção atual (mesmo as de 1 cópia só) como
  // para troca, sem alterar quantidade/variação - só a flag isForTrade.
  const handleMarkAllForTradeInSet = () => {
    const updatedOwnedCards = { ...user.ownedCards };
    setCards.forEach(card => {
      const current = updatedOwnedCards[card.id];
      if (!current || getCardTotalQuantity(current.variations) <= 0) return;
      updatedOwnedCards[card.id] = { ...current, isForTrade: true };
    });
    onUpdateUser({ ...user, ownedCards: updatedOwnedCards });
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    // O backend já filtra por nome/número/coleção/artista; aqui só restringe à era atual
    // quando o usuário está navegando dentro de uma era específica.
    if (selectedSeries && !selectedSet) {
      return globalSearchResults.filter(card => {
        const foundSet = sets.find(s => s.id === card.set?.id);
        return foundSet?.series === selectedSeries;
      });
    }
    return globalSearchResults;
  }, [globalSearchResults, searchQuery, selectedSeries, selectedSet, sets]);

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

  const tierStats = useMemo(() => {
    if (!selectedSet || setCards.length === 0) return null;
    return getSetTierStats(setCards, user.ownedCards, setVariantFlags);
  }, [selectedSet, setCards, user.ownedCards, setVariantFlags]);

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
        <div className="flex items-center justify-center gap-1.5 mb-6 pt-4">
            {selectedSet.symbolUrl && <CardImage src={selectedSet.symbolUrl} alt="" className="w-3.5 h-3.5 object-contain flex-shrink-0" />}
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

          <div className="mt-2">
            <SetProgressBar stats={tierStats} />
          </div>
        </div>

        {/* Abas de Filtro */}
        <div className="flex items-center gap-2 mb-3">
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

        {/* Base Set / Complete Set / Master Set - Master Set explode cada carta por variação
            e não é editável (ver masterEntries), então os botões em lote abaixo somem lá. */}
        <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100 mb-3">
          {([
            ['base', 'Base Set'],
            ['complete', 'Complete Set'],
            ['master', 'Master Set'],
          ] as [SetTierFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSetTierFilter(value)}
              className={`flex-1 py-2 rounded-lg text-[10px] uppercase tracking-widest transition-all ${setTierFilter === value ? 'bg-white text-[#9B6BD9] shadow-sm font-semibold' : 'text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {setTierFilter === 'master' && (
          <p className="text-[9px] text-slate-400 mb-3 px-1">
            Somente leitura - mostra 1 carta por variação que ela realmente tem, colorida conforme você já registrou pelo menos 1 unidade daquela variação específica.
          </p>
        )}

        {setTierFilter !== 'master' && (
          <div className="mb-4 flex gap-2">
            <button
              onClick={handleSelectAllInSet}
              className="flex-1 py-2 bg-[#646B99]/5 border border-[#646B99]/20 text-[#646B99] text-[10px] font-semibold uppercase tracking-widest rounded-xl hover:bg-[#646B99]/10 transition-colors"
            >
              Selecionar Todos (1x Standard NM)
            </button>
            <button
              onClick={handleMarkAllForTradeInSet}
              className="flex-1 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold uppercase tracking-widest rounded-xl hover:bg-emerald-100 transition-colors"
            >
              Colocar Todas Para Troca
            </button>
          </div>
        )}

        <div className={getCardGridClassName(viewMode)}>
          {setTierFilter === 'master' ? (
            loadingCards ? (
              [...Array(6)].map((_, i) => <div key={i} className="aspect-[2/2.8] bg-slate-100 animate-pulse rounded-xl" />)
            ) : masterEntries.length === 0 ? (
              <div className="col-span-full py-20 text-center">
                <p className="text-slate-400 text-xs uppercase tracking-widest">
                  {Object.keys(setVariantFlags).length === 0 ? 'Carregando variações...' : 'Nenhuma carta encontrada'}
                </p>
              </div>
            ) : (
              masterEntries.map(entry => (
                <MasterSetTile
                  key={`${entry.card.id}::${entry.variation}`}
                  card={entry.card}
                  variation={entry.variation}
                  owned={entry.owned}
                  viewMode={viewMode}
                />
              ))
            )
          ) : loadingCards ? (
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
        <div className="relative z-10 p-4">
            <div className="flex items-center justify-center mb-6 pt-4">
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
             // md:grid-cols-3 é só no desktop - no mobile continua o grid-cols-2 de sempre
             <div className="grid grid-cols-2 md:grid-cols-3 gap-4 px-2">
             {setsInSeries.map(set => {
                const tierStats = getSetTierStatsFromCounts(set, user.ownedCards);
                return (
                  <button
                    key={set.id}
                    onClick={() => setSelectedSet(set)}
                    className="flex flex-col items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group min-h-[160px]"
                  >
                    <div className="h-14 w-full flex items-center justify-center mb-2">
                        <CardImage src={set.logoUrl} alt="" className="max-h-full max-w-full object-contain filter group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="w-full space-y-2 mt-auto">
                        <p className="text-[10px] font-medium text-slate-600 text-center line-clamp-1 group-hover:text-[#646B99] transition-colors flex items-center justify-center gap-1">
                            {set.symbolUrl && <CardImage src={set.symbolUrl} alt="" className="w-3 h-3 object-contain flex-shrink-0" />}
                            {set.name}
                        </p>
                        <SetProgressBar stats={tierStats} size="sm" />
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
    <div className="bg-white px-8 pb-10 flex flex-col items-center gap-6 animate-in fade-in duration-500 pt-4">
      {searchQuery.trim() !== '' ? (
        // Se houver pesquisa, exibe os resultados globais de busca
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 gap-2">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Resultados da Pesquisa ({searchResults.length})
            </h3>
            <div className="flex items-center gap-2">
              {searchingGlobal && (
                <span className="text-[10px] text-slate-400 animate-pulse">Buscando...</span>
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

          {/* md:grid-cols-3 é só no desktop - no mobile continua a mesma pilha de 1 coluna de sempre */}
          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4">
            {eras.map(era => (
              <button
                key={era}
                onClick={() => setSelectedSeries(era)}
                className="w-full flex flex-col items-center justify-between bg-transparent p-5 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group gap-3 min-h-[130px]"
              >
                <div className="h-16 w-full flex items-center justify-center px-4">
                    <CardImage
                        src={getSetLogoForSeries(era)}
                        alt={era}
                        // Largura máxima baseada no tamanho do logo do Sword & Shield (a referência
                        // considerada ideal) - logos com proporção mais larga (ex: Black & White)
                        // não esticam além disso; logos já mais estreitos não são forçados a crescer.
                        className="max-h-full max-w-[min(100%,328px)] object-contain filter group-hover:scale-110 transition-all duration-500"
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
