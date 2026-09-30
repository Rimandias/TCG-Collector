
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, PokemonSet, UserCardData, Card, CardCondition } from '../types';
import { fetchSets, fetchCardsBySet, fetchSetVariantFlags, CardVariantInfo } from '../api';
import CardImage from '../components/CardImage';
import CardItem, { CardViewMode } from '../components/CardItem';
import CardModal from '../components/CardModal';
import CardViewModeSelector from '../components/CardViewModeSelector';
import MasterSetTile from '../components/MasterSetTile';
import SetProgressBar from '../components/SetProgressBar';
import TierDots from '../components/TierDots';
import { getCardTotalQuantity, getCardEstimatedValue, getCompleteCardNumber, getNormalizedVariations, getVariationSubtotal, getDefaultVariationType, getConfirmedVariationTypes, getVariationSlot, ensureVariationSlot } from '../db';
import { getCardGridClassName, getInitialCardViewMode, saveCardViewMode } from '../viewMode';
import { getSetTierStats, getSetTierStatsFromCounts, aggregateSetTierStats } from '../setProgress';

type SetTierFilter = 'base' | 'complete' | 'master';

interface CollectionViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
  selectedEra: string | null;
  setSelectedEra: (era: string | null) => void;
  selectedSet: PokemonSet | null;
  setSelectedSet: (set: PokemonSet | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const hasAnyOwnedCard = (ownedCards: User['ownedCards'], setId: string): boolean => {
  const prefix = `${setId}-`;
  return Object.keys(ownedCards).some(id => id.startsWith(prefix) && getCardTotalQuantity(ownedCards[id]?.variations) > 0);
};

const MiniStatIcon: React.FC<{ path: React.ReactNode; className?: string }> = ({ path, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className || 'w-5 h-5'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const CollectionView: React.FC<CollectionViewProps> = ({
  user,
  onUpdateUser,
  selectedEra,
  setSelectedEra,
  selectedSet,
  setSelectedSet,
  searchQuery,
  setSearchQuery,
}) => {
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [variantFlagsBySet, setVariantFlagsBySet] = useState<Record<string, Record<string, CardVariantInfo>>>({});
  const requestedSetIdsRef = useRef<Set<string>>(new Set());

  // --- Estado da tela de detalhe do set (Coleção Selecionada) ---
  const [setCards, setSetCards] = useState<Card[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [setVariantFlags, setSetVariantFlags] = useState<Record<string, CardVariantInfo>>({});
  const [infoCard, setInfoCard] = useState<Card | null>(null);
  const [filterTab, setFilterTab] = useState<'tudo' | 'restantes'>('tudo');
  const [setTierFilter, setSetTierFilter] = useState<SetTierFilter>('complete');
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);

  useEffect(() => {
    saveCardViewMode(viewMode);
  }, [viewMode]);

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

  // Carrega as cartas do set aberto (Coleção Selecionada) - mesmo padrão da Home.
  useEffect(() => {
    if (!selectedSet) {
      setSetCards([]);
      return;
    }
    let cancelled = false;
    const loadCards = async () => {
      setLoadingCards(true);
      try {
        const cards = await fetchCardsBySet(selectedSet.id);
        const sorted = [...cards].sort((a, b) => {
          const numA = parseInt(a.number.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.number.replace(/\D/g, '')) || 0;
          return numA - numB;
        });
        if (!cancelled) setSetCards(sorted);
      } finally {
        if (!cancelled) setLoadingCards(false);
      }
    };
    loadCards();
    return () => {
      cancelled = true;
    };
  }, [selectedSet]);

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

  // Agrupa só os sets já possuídos por era - a mesma regra de sempre, só que agora cada
  // grupo vira uma navegação ("Era selecionada") em vez de um acordeão expandido inline.
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

  const currentEraGroup = useMemo(
    () => eraGroups.find(g => g.series === selectedEra) || null,
    [eraGroups, selectedEra]
  );

  const getEraYear = (setsInEra: PokemonSet[]) => {
    const dates = setsInEra.map(s => s.releaseDate).filter(Boolean).sort();
    const startYear = dates[0]?.split('-')[0];
    const endYear = dates[dates.length - 1]?.split('-')[0];
    if (!startYear) return '';
    return startYear === endYear ? startYear : `${startYear}-${endYear}`;
  };

  // --- Filtros/edição da Coleção Selecionada (mesma lógica da Home, escopada a este set) ---
  const filteredCards = useMemo(() => {
    let base = setTierFilter === 'base' ? setCards.filter(c => !c.isSecret) : setCards;
    if (filterTab === 'restantes') {
      base = base.filter(card => {
        const cardData = user.ownedCards[card.id];
        if (!cardData) return true;
        return getCardTotalQuantity(cardData.variations) === 0;
      });
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      base = base.filter(card => {
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        const matchesName = card.name.toLowerCase().includes(q);
        const matchesNum = card.number.toLowerCase() === q || fullNum === q || card.number.toLowerCase().includes(q) || fullNum.includes(q);
        const matchesArtist = (card.artist || '').toLowerCase().includes(q);
        return matchesName || matchesNum || matchesArtist;
      });
    }
    return base;
  }, [setCards, setTierFilter, filterTab, searchQuery, user.ownedCards]);

  interface MasterEntry { card: Card; variation: string; owned: boolean; }
  const masterEntries = useMemo((): MasterEntry[] => {
    if (setTierFilter !== 'master') return [];
    const q = searchQuery.toLowerCase().trim();
    const entries: MasterEntry[] = [];
    for (const card of setCards) {
      if (q) {
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        const matches = card.name.toLowerCase().includes(q) || card.number.toLowerCase().includes(q) || fullNum.includes(q);
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

  const setStats = useMemo(() => {
    if (!selectedSet || setCards.length === 0) return null;
    const secretCards = setCards.filter(c => c.isSecret);
    const ownedCardsInSet = setCards.filter(c => getCardTotalQuantity(user.ownedCards[c.id]?.variations) > 0);
    const estimatedValue = ownedCardsInSet.reduce((acc, card) => acc + getCardEstimatedValue(user.ownedCards[card.id]?.variations), 0);
    return {
      totalCards: setCards.length,
      secretCount: secretCards.length,
      value: estimatedValue,
    };
  }, [selectedSet, setCards, user.ownedCards]);

  const setTierStats = useMemo(() => {
    if (!selectedSet || setCards.length === 0) return null;
    return getSetTierStats(setCards, user.ownedCards, setVariantFlags);
  }, [selectedSet, setCards, user.ownedCards, setVariantFlags]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 bg-white min-h-[80vh]">
        <div className="w-10 h-10 border-4 border-[#616895] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-xs uppercase tracking-widest">Calculando Estatísticas...</p>
      </div>
    );
  }

  // --- Screen 3: Coleção Selecionada (detalhe de um set) ---
  if (selectedSet) {
    return (
      <div className="animate-in slide-in-from-right duration-300 px-6 pb-20 pt-4">
        <h2 className="text-xl text-slate-800 font-semibold text-center uppercase tracking-tight">
          {selectedSet.name} - {selectedSet.releaseDate.split('-')[0]}
        </h2>

        <div className="mt-6 grid grid-cols-3 gap-2.5">
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <MiniStatIcon className="w-[18px] h-[18px] text-slate-500" path={<><path d="m7 15-5-5 5-5"/><path d="M2 10h15a5 5 0 1 1 0 10H2"/></>} />
            <p className="text-[8px] text-[var(--color-text-muted)]">{setStats?.totalCards ?? selectedSet.total} cartas</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <MiniStatIcon className="w-[18px] h-[18px] text-slate-500" path={<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>} />
            <p className="text-[8px] text-[var(--color-text-muted)]">{setStats?.secretCount ?? 0} secretas</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-2.5 min-h-[68px] p-2.5 bg-[var(--color-surface)] rounded-md shadow-[var(--shadow-inset)] text-center">
            <MiniStatIcon className="w-[18px] h-[18px] text-slate-500" path={<path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/>} />
            <p className="text-[8px] text-[var(--color-text-muted)] leading-tight">Valor estimado<br />R${(setStats?.value ?? 0).toFixed(2)}</p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <SetProgressBar stats={setTierStats} />
          <div className="flex items-center justify-between">
            <TierDots stats={setTierStats} />
            {selectedSet.symbolUrl && (
              <div className="w-9 h-5 rounded-[3px] bg-black flex items-center justify-center flex-shrink-0 overflow-hidden">
                <CardImage src={selectedSet.symbolUrl} alt="" className="w-full h-full object-contain p-0.5" fallback="empty" />
              </div>
            )}
          </div>
        </div>

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
          <CardModal card={infoCard} user={user} onUpdateUser={onUpdateUser} onClose={() => setInfoCard(null)} />
        )}
      </div>
    );
  }

  // --- Screen 2: Era selecionada (grade de sets da era) ---
  if (currentEraGroup) {
    return (
      <div className="animate-in slide-in-from-right duration-300 px-6 pb-20 pt-4">
        <h2 className="text-xl text-slate-800 font-semibold text-center uppercase tracking-tight">{currentEraGroup.series}</h2>
        <p className="text-xs text-slate-400 text-center mt-1">{getEraYear(currentEraGroup.sets)}</p>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {currentEraGroup.sets.map(set => {
            const stats = calculateStats(set).tierStats;
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
                  <TierDots stats={stats} size="xs" />
                  {set.symbolUrl && (
                    <div className="w-9 h-[19px] rounded-[3px] bg-black flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <CardImage src={set.symbolUrl} alt="" className="w-full h-full object-contain p-0.5" fallback="empty" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // --- Screen 1: Minha Pasta (lista de eras) ---
  return (
    <div className="animate-in fade-in duration-500 px-6 pb-20 pt-4">
      <div className="mb-10 flex items-end justify-between border-b border-slate-50 pb-6">
        <div>
          <h2 className="text-2xl text-slate-800 tracking-tight leading-none">Minha Pasta</h2>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-2">Status do Mestre Treinador</p>
        </div>
        <div className="text-right">
          <div className="text-3xl text-[#616895] leading-none">
            {globalStats.uniqueOwned}<span className="text-lg text-slate-300">/{totalCollectibleCards}</span>
          </div>
          <div className="text-[9px] uppercase text-slate-300 tracking-widest mt-1">Cartas Unitárias Colecionadas</div>
          <div className="text-sm text-slate-500 leading-none mt-2">{globalStats.totalOwned}</div>
          <div className="text-[9px] uppercase text-slate-300 tracking-widest mt-1">Total de cartas (com as repetidas)</div>
        </div>
      </div>

      <div className="mb-6 bg-[var(--color-primary)] rounded-3xl p-6 shadow-[var(--shadow-card-lg)]">
        <p className="text-[10px] text-white/60 uppercase tracking-widest">Valor Total da Coleção</p>
        <p className="text-3xl text-white font-semibold mt-1">R${globalStats.totalValue.toFixed(2)}</p>
        <p className="text-[9px] text-white/50 mt-1">Soma de todas as coleções, baseada nos preços que você informou</p>
      </div>

      <div className="grid gap-4">
        {eraGroups.map(({ series, sets: setsInEra, tierStats }) => (
          <button
            key={series}
            onClick={() => setSelectedEra(series)}
            className="w-full flex items-center justify-between gap-4 p-5 text-left bg-[var(--color-surface-card)] rounded-3xl border border-[var(--color-border)] shadow-[var(--shadow-card)] hover:bg-slate-50/60 transition-colors"
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
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-300 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CollectionView;
