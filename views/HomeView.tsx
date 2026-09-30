
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { User, PokemonSet, Card, UserCardData, CardCondition } from '../types';
import { fetchSets, fetchCardsBySet, searchCards, fetchSetVariantFlags, CardVariantInfo } from '../api';
import CardItem, { CardViewMode } from '../components/CardItem';
import CardImage from '../components/CardImage';
import CardViewModeSelector from '../components/CardViewModeSelector';
import CardModal from '../components/CardModal';
import SetProgressBar from '../components/SetProgressBar';
import TierDots from '../components/TierDots';
import MasterSetTile from '../components/MasterSetTile';
import { getCardTotalQuantity, getCompleteCardNumber, getCardEstimatedValue, getNormalizedVariations, getVariationSubtotal, getDefaultVariationType, reconcileVariationsWithApiFlags, getConfirmedVariationTypes, getVariationSlot, ensureVariationSlot } from '../db';
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
  // Flags de variação (pra % de "Variações" do progresso em camadas) dos sets já possuídos
  // mostrados na grade "sets de uma era" - sem isso, o card do set nessa grade nunca sabia a
  // % de variações (sempre 0%) e podia mostrar cor/total diferentes da tela de detalhe do
  // set/Minha Pasta pro mesmo set (ex: 200% verde ali, 300% roxo aqui). Só busca pra sets com
  // pelo menos 1 carta possuída, igual ao mesmo padrão em CollectionView.tsx.
  const [seriesVariantFlags, setSeriesVariantFlags] = useState<Record<string, Record<string, CardVariantInfo>>>({});
  const requestedSeriesSetIdsRef = useRef<Set<string>>(new Set());
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

  // Corrige em lote cartas do set aberto que ficaram com uma variação que a API não confirma
  // (ex: "Selecionar Todos" antes da correção acima sempre cravava Standard, mesmo em cartas
  // sem essa variação) - mesma migração que o CardModal já faz sozinho, uma carta de cada vez,
  // ao abrir o +Info (ver reconcileVariationsWithApiFlags em db.ts), só que aplicada de uma vez
  // pra todo o set assim que as flags reais chegam, sem precisar abrir cada carta manualmente.
  useEffect(() => {
    if (setCards.length === 0 || Object.keys(setVariantFlags).length === 0) return;
    let updatedOwnedCards: typeof user.ownedCards | null = null;
    for (const card of setCards) {
      const cardData = user.ownedCards[card.id];
      if (!cardData) continue;
      const flags = setVariantFlags[card.id]?.flags;
      const { variations, migrated } = reconcileVariationsWithApiFlags(cardData.variations, flags);
      if (migrated) {
        updatedOwnedCards = updatedOwnedCards || { ...user.ownedCards };
        updatedOwnedCards[card.id] = { ...cardData, variations };
      }
    }
    if (updatedOwnedCards) {
      onUpdateUser({ ...user, ownedCards: updatedOwnedCards });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCards, setVariantFlags]);

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

  const setsInSeries = useMemo(() => {
    return sets
      .filter(s => s.series === selectedSeries)
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  }, [sets, selectedSeries]);

  useEffect(() => {
    if (setsInSeries.length === 0) return;
    const toFetch = setsInSeries
      .filter(set => {
        const prefix = `${set.id}-`;
        return Object.keys(user.ownedCards).some(id => id.startsWith(prefix) && getCardTotalQuantity(user.ownedCards[id]?.variations) > 0);
      })
      .map(set => set.id)
      .filter(id => !requestedSeriesSetIdsRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach(id => requestedSeriesSetIdsRef.current.add(id));

    let cancelled = false;
    toFetch.forEach(async (setId) => {
      const flags = await fetchSetVariantFlags(setId);
      if (!cancelled) setSeriesVariantFlags(prev => ({ ...prev, [setId]: flags }));
    });
    return () => {
      cancelled = true;
    };
  }, [setsInSeries, user.ownedCards]);

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
      for (const variation of getConfirmedVariationTypes(flags)) {
        const owned = getVariationSubtotal(getVariationSlot(normalized, variation)) > 0;
        if (filterTab === 'restantes' && owned) continue;
        entries.push({ card, variation, owned });
      }
    }
    return entries;
  }, [setTierFilter, setCards, setVariantFlags, user.ownedCards, filterTab, searchQuery]);

  // Marca de uma vez todas as cartas da coleção atual que ainda não são possuídas como 1x NM,
  // sem sobrescrever cartas já possuídas. Nem toda carta tem a variação Standard (promos,
  // exclusivas de Pokebola/Master Ball etc.) - usa a mesma regra do toque individual
  // (getDefaultVariationType, CardItem.tsx): Standard se a carta realmente tem, senão a
  // primeira variação real que ela tem. Antes disso sempre cravava Standard, criando cartas
  // com uma variação que a API nunca confirmou (só corrigida depois, uma a uma, ao abrir o
  // +Info de cada uma).
  const handleSelectAllInSet = () => {
    const updatedOwnedCards = { ...user.ownedCards };
    filteredCards.forEach(card => {
      const current = updatedOwnedCards[card.id];
      const alreadyOwned = current && getCardTotalQuantity(current.variations) > 0;
      if (alreadyOwned) return;
      const variation = getDefaultVariationType(setVariantFlags[card.id]?.flags);
      const normalized = getNormalizedVariations(current?.variations || {});
      ensureVariationSlot(normalized, variation)[CardCondition.NM].quantity = 1;
      updatedOwnedCards[card.id] = {
        cardId: card.id,
        isOwned: true,
        isForTrade: current?.isForTrade || false,
        variations: normalized,
      };
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
        <div className="w-10 h-10 border-4 border-[#616895] border-t-transparent rounded-full animate-spin" />
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
          className="px-8 py-3 bg-[#616895] text-white text-xs uppercase tracking-widest rounded-full hover:bg-[#4a4d73] transition-all shadow-lg"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  // Divisória "costura de bola de pokébola" entre o conteúdo branco e o fundo temático da
  // era (ver renderPokeballBottomBg) - mesma faixa preta com o círculo central que a tela
  // "Era selecionada" sempre teve.
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

  // Fundo temático (cor + recortes de bola) atrás da grade de sets de uma era - cicla entre
  // 4 estilos de pokébola pela posição da era na lista (mais recente primeiro), aparecendo
  // nos vãos entre os cards brancos do grid acima dele.
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
      <div className="animate-in slide-in-from-right duration-300 px-6 pb-10 pt-4">
        <h2 className="text-xl text-slate-800 font-semibold text-center uppercase tracking-tight">
          {selectedSet.name} - {selectedSet.releaseDate.split('-')[0]}
        </h2>

        <div className="mt-6 grid grid-cols-3 gap-2.5">
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[19px] text-slate-500" viewBox="0 0 20 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.75 1H13.73C13.9899 1 14.2392 1.10531 14.423 1.29276C14.6068 1.4802 14.71 1.73444 14.71 1.99953V5.49788M17.6501 2.99906C17.9089 3.11101 18.1597 3.21596 18.4028 3.31391C18.642 3.41745 18.8312 3.61367 18.9286 3.8594C19.026 4.10514 19.0237 4.38027 18.9222 4.62429L16.6701 9.99577M1.58151 4.1955L8.57698 1.08796C8.69242 1.0375 8.81659 1.01112 8.94218 1.01038C9.06776 1.00963 9.19222 1.03454 9.30822 1.08364C9.42422 1.13273 9.52941 1.20501 9.61758 1.29622C9.70576 1.38743 9.77514 1.49572 9.82163 1.61471L14.6473 13.5111C14.7476 13.7523 14.751 14.0241 14.6568 14.2679C14.5626 14.5117 14.3783 14.7079 14.1436 14.8145L7.14908 17.922C7.03359 17.9727 6.90933 17.9992 6.78364 18C6.65794 18.0008 6.53336 17.9759 6.41724 17.9268C6.30113 17.8777 6.19584 17.8054 6.1076 17.7141C6.01935 17.6228 5.94994 17.5144 5.90346 17.3953L1.07777 5.49788C0.977471 5.25665 0.97406 4.98489 1.06827 4.74112C1.16249 4.49734 1.3468 4.30205 1.58151 4.1955Z" /></svg>
            <p className="text-[8px] text-[var(--color-text-muted)]">{setStats?.totalCards || selectedSet.total} cartas</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px] text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <p className="text-[8px] text-[var(--color-text-muted)]">{setStats?.secretCount ?? 0} secretas</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px] text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/></svg>
            <p className="text-[8px] text-[var(--color-text-muted)] leading-tight">Valor estimado<br />R${setStats?.value.toFixed(2) ?? '0.00'}</p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <SetProgressBar stats={tierStats} />
          <div className="flex items-center justify-between">
            <TierDots stats={tierStats} />
            {selectedSet.symbolUrl && (
              <CardImage src={selectedSet.symbolUrl} alt="" className="w-9 h-5 rounded-[3px] object-cover flex-shrink-0" fallback="empty" />
            )}
          </div>
        </div>

        {/* Abas de Filtro */}
        <div className="mt-5 flex items-center gap-2">
          <div className="flex flex-1 bg-[var(--color-surface)] p-1 rounded-md border border-[var(--color-border)] shadow-[var(--shadow-inset)]">
            <button
              onClick={() => setFilterTab('tudo')}
              className={`flex-1 py-2 rounded-sm text-xs transition-all ${filterTab === 'tudo' ? 'bg-white text-[var(--color-text-muted)] shadow-[var(--shadow-tab)]' : 'text-[var(--color-text-muted)]'}`}
            >
              Tudo
            </button>
            <button
              onClick={() => setFilterTab('restantes')}
              className={`flex-1 py-2 rounded-sm text-xs transition-all ${filterTab === 'restantes' ? 'bg-white text-[var(--color-text-muted)] shadow-[var(--shadow-tab)]' : 'text-[var(--color-text-muted)]'}`}
            >
              Restantes
            </button>
          </div>
          <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
        </div>

        {/* Base Set / Complete Set / Master Set - Master Set explode cada carta por variação
            e não é editável (ver masterEntries), então os botões em lote abaixo somem lá. */}
        <div className="mt-2 flex bg-[var(--color-surface)] p-1 rounded-md border border-[var(--color-border)] shadow-[var(--shadow-inset)]">
          {([
            ['base', 'Base set'],
            ['complete', 'Complete set'],
            ['master', 'Master set'],
          ] as [SetTierFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSetTierFilter(value)}
              className={`flex-1 py-2 rounded-sm text-xs transition-all ${setTierFilter === value ? 'bg-white text-[var(--color-primary)] shadow-[var(--shadow-tab)] font-medium' : 'text-[var(--color-text-muted)]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {setTierFilter === 'master' && (
          <p className="text-[9px] text-slate-400 mt-3 px-1">
            Somente leitura - mostra 1 carta por variação que ela realmente tem, colorida conforme você já registrou pelo menos 1 unidade daquela variação específica.
          </p>
        )}

        {setTierFilter !== 'master' && (
          <button
            onClick={handleSelectAllInSet}
            className="mt-3 w-full py-2.5 bg-white border border-[var(--color-border-strong)] text-[var(--color-text-muted)] text-sm rounded-md shadow-[var(--shadow-tab)] hover:bg-slate-50 transition-colors"
          >
            Selecionar todas
          </button>
        )}

        <div className={`mt-4 ${getCardGridClassName(viewMode)}`}>
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
        {/* Camada de fundo fixa (mesma "carta-mãe" temática por era que a Home sempre teve -
            cor/pokébola aparecendo nos vãos entre os cards do grid, ver getEraBallStyle) */}
        <div className="fixed inset-x-0 bottom-0 h-[50vh] pointer-events-none z-0 flex flex-col justify-end">
          <PokeballDivider />
          <div className="w-full flex-1 overflow-hidden relative">
            {renderPokeballBottomBg(selectedSeries)}
          </div>
        </div>

        <div className="relative z-10 px-6 pt-4">
          <h2 className="text-xl text-slate-800 font-semibold text-center uppercase tracking-tight">{selectedSeries}</h2>
          <p className="text-xs text-slate-400 text-center mt-1">{getEraYear(selectedSeries)}</p>

          {searchQuery.trim() !== '' ? (
            <div className="mt-6 space-y-4">
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
            <div className="mt-6 grid grid-cols-2 gap-4">
              {setsInSeries.map(set => {
                const tierStats = getSetTierStatsFromCounts(set, user.ownedCards, seriesVariantFlags[set.id]);
                return (
                  <button
                    key={set.id}
                    onClick={() => setSelectedSet(set)}
                    className="flex flex-col justify-center gap-2 h-40 p-4 bg-white border border-[var(--color-border)] rounded-md shadow-[var(--shadow-card)] text-left"
                  >
                    <div className="h-8 w-full flex items-center justify-center">
                      <CardImage src={set.logoUrl} alt="" className="max-h-full max-w-full object-contain" fallback="empty" />
                    </div>
                    <p className="text-xs text-slate-700 text-center truncate">{set.name}</p>
                    <div className="flex items-center justify-between">
                      <TierDots stats={tierStats} size="xs" />
                      {set.symbolUrl && (
                        <CardImage src={set.symbolUrl} alt="" className="w-9 h-[19px] rounded-[3px] object-cover flex-shrink-0" fallback="empty" />
                      )}
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
