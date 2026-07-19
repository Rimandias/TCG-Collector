import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Card, UserCardData, TradeFolder, Friend, Trade, CardCondition, VARIATION_TYPES } from '../types';
import { updateCardStatus, getNormalizedVariations, getCardTotalQuantity, getInitialCardData, getCompleteCardNumber, getCardEstimatedValue } from '../db';
import { fetchCardsBySet, fetchSets } from '../api';
import { createTradeRequest, getMyTrades, TradeItemSelection } from '../trades';
import { fetchCurrentUser } from '../auth';
import CardModal from '../components/CardModal';
import FriendFolderBrowser from '../components/FriendFolderBrowser';
import TradeActionModal from '../components/TradeActionModal';
import Pagination, { PAGE_SIZE } from '../components/Pagination';

const TRADE_POLL_INTERVAL_MS = 15000;

function needsMyAction(trade: Trade, myId: string): boolean {
  if (trade.status === 'completed' || trade.status === 'cancelled') return false;
  const isInitiator = trade.initiatorId === myId;
  const isRecipient = trade.recipientId === myId;
  if (trade.status === 'pending_response' || trade.status === 'selecting_offer') return isRecipient;
  if (trade.status === 'awaiting_payment_confirmation' || trade.status === 'awaiting_value_diff_confirmation') {
    return isInitiator ? !trade.initiatorConfirmed : !trade.recipientConfirmed;
  }
  return false;
}

interface TradesViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
}

const TradesView: React.FC<TradesViewProps> = ({ user, onUpdateUser }) => {
  const [activeTab, setActiveTab] = useState<'my' | 'friends'>('my');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Friend detail states
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);

  // Pedido de troca (escolhendo cartas de um amigo)
  const [pendingTradeConfirm, setPendingTradeConfirm] = useState<{ folderId: string; items: TradeItemSelection[]; totalValue: number } | null>(null);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeSuccessMessage, setTradeSuccessMessage] = useState<string | null>(null);

  // Negociações de troca (notificação, resposta, pagamento/oferta)
  const [myTrades, setMyTrades] = useState<Trade[]>([]);
  const [activeTradeModal, setActiveTradeModal] = useState<Trade | null>(null);
  const [dismissedTradeIds, setDismissedTradeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const trades = await getMyTrades();
      if (!cancelled) setMyTrades(trades);
    };
    poll();
    const interval = setInterval(poll, TRADE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const actionableTrades = useMemo(
    () => myTrades.filter((t) => needsMyAction(t, user.id) && !dismissedTradeIds.has(t.id)),
    [myTrades, user.id, dismissedTradeIds]
  );
  const activeTrades = useMemo(
    () => myTrades.filter((t) => t.status !== 'completed' && t.status !== 'cancelled'),
    [myTrades]
  );

  useEffect(() => {
    if (!activeTradeModal && actionableTrades.length > 0) {
      setActiveTradeModal(actionableTrades[0]);
    }
  }, [actionableTrades, activeTradeModal]);

  const handleTradeChanged = async (updated: Trade) => {
    setMyTrades((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    if (updated.status === 'completed' || updated.status === 'cancelled') {
      setActiveTradeModal(null);
      const freshUser = await fetchCurrentUser();
      if (freshUser) onUpdateUser(freshUser);
    } else {
      setActiveTradeModal(updated);
    }
  };

  const closeTradeModal = () => {
    if (activeTradeModal) {
      setDismissedTradeIds((prev) => new Set(prev).add(activeTradeModal.id));
    }
    setActiveTradeModal(null);
  };

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showManageCards, setShowManageCards] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tradeCards, setTradeCards] = useState<{card: Card, data: UserCardData}[]>([]);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  // New features states (Lists and metadata)
  const [allSetCards, setAllSetCards] = useState<Card[]>([]);
  const [loadingWishlist, setLoadingWishlist] = useState(false);
  const [sets, setSets] = useState<any[]>([]);

  // Folder visual states (Toggle "Cartas" vs "Coleção")
  const [folderViewMode, setFolderViewMode] = useState<'cards' | 'collections'>('cards');
  const [selectedFolderSeries, setSelectedFolderSeries] = useState<string | null>(null);
  const [selectedFolderSetId, setSelectedFolderSetId] = useState<string | null>(null);

  // Search/Filters states inside folders
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRarity, setFilterRarity] = useState('all');
  const [filterSet, setFilterSet] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterQuality, setFilterQuality] = useState('all');
  const [showFolderFilters, setShowFolderFilters] = useState(false);

  // Memoized user folders
  const folders = useMemo<TradeFolder[]>(() => user.folders || [], [user.folders]);

  // Carrega as informações das cartas que estão marcadas para troca ou possuem duplicatas (>1 cópias)
  useEffect(() => {
    const loadTradeCards = async () => {
      setLoading(true);
      const trades = (Object.entries(user.ownedCards) as [string, UserCardData][])
        .filter(([_, data]) => {
          // Automatic duplicate rule: more than 1 copy of any quality and category
          const normalized = getNormalizedVariations(data.variations);
          const hasDuplicate = Object.values(normalized).some(conditionsObj => 
            Object.values(conditionsObj).some(details => details.quantity > 1)
          );
          return data.isForTrade || hasDuplicate;
        });
      
      const loaded: {card: Card, data: UserCardData}[] = [];
      
      for (const [id, data] of trades) {
        const setId = id.split('-')[0];
        try {
          const cardsInSet = await fetchCardsBySet(setId);
          const card = cardsInSet.find(c => c.id === id);
          if (card) loaded.push({ card, data });
        } catch (e) {
          console.error("Failed to fetch cards in set", setId, e);
        }
      }
      
      setTradeCards(loaded);
      setLoading(false);
    };

    if (activeTab === 'my') {
      loadTradeCards();
    }
  }, [user.ownedCards, activeTab]);

  // Carrega as coleções e todas as cartas das coleções em paralelo para a Lista de Desejos
  useEffect(() => {
    const loadSetsAndAllCards = async () => {
      setLoadingWishlist(true);
      try {
        const setsList = await fetchSets();
        if (setsList) {
          setSets(setsList);
          
          const allCards: Card[] = [];
          const promises = setsList.map(async (s) => {
            try {
              return await fetchCardsBySet(s.id);
            } catch (e) {
              return [];
            }
          });
          const results = await Promise.all(promises);
          results.forEach(cards => {
            allCards.push(...cards);
          });
          setAllSetCards(allCards);
        }
      } catch (err) {
        console.warn("Error loading wishlist sets/cards (handled with fallback/mock cards):", err);
      } finally {
        setLoadingWishlist(false);
      }
    };
    loadSetsAndAllCards();
  }, []);

  // Lista de Desejos: Cartas adicionadas manualmente via coração pelo usuário
  const wishlistCards = useMemo(() => {
    const wishlistIds = user.wishlist || [];
    return allSetCards.filter(card => wishlistIds.includes(card.id));
  }, [allSetCards, user.wishlist]);

  // Estrutura de Eras/Coleções idêntica à Home
  const eras = useMemo(() => {
    const uniqueSeries: string[] = Array.from(new Set(sets.map(s => s.series)));

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
    
    const styles = [
      { bg: 'bg-red-600', dotBg: 'bg-red-500' },
      { bg: 'bg-blue-600', dotBg: 'bg-red-500' },
      { bg: 'bg-zinc-950', dotBg: 'bg-yellow-400' },
      { bg: 'bg-purple-600', dotBg: 'bg-pink-500' },
    ];
    
    return styles[safeIndex % styles.length];
  }, [eras]);

  const getSetLogoForSeries = useCallback((seriesName: string) => {
    const seriesSets = sets.filter(s => s.series === seriesName);
    if (seriesSets.length === 0) return '';
    const sorted = [...seriesSets].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    return sorted[0]?.logoUrl || '';
  }, [sets]);

  const getEraYear = useCallback((eraName: string) => {
    const eraSets = sets.filter(s => s.series === eraName);
    if (eraSets.length === 0) return '';
    const dates = eraSets.map(s => s.releaseDate).sort();
    const oldestDate = dates[0];
    if (!oldestDate) return '';
    return oldestDate.split('-')[0];
  }, [sets]);

  // Unifica a obtenção das cartas da pasta ativa (duplicates, wishlist, custom)
  const activeFolderCards = useMemo(() => {
    if (selectedFolderId === 'duplicates') {
      return tradeCards;
    } else if (selectedFolderId === 'wishlist') {
      return wishlistCards.map(card => ({
        card,
        data: user.ownedCards[card.id] || getInitialCardData(card.id)
      }));
    } else if (selectedFolderId) {
      const currentFolder = folders.find(f => f.id === selectedFolderId);
      return tradeCards.filter(tc => currentFolder?.cardIds.includes(tc.card.id));
    }
    return [];
  }, [selectedFolderId, tradeCards, wishlistCards, folders, user.ownedCards]);

  // Aplicação de todos os filtros nas cartas da pasta
  const filteredFolderCards = useMemo(() => {
    return activeFolderCards.filter(({ card, data }) => {
      // 1. Campo de Pesquisa (pesquisa por nome, número ou set)
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const fullNum = getCompleteCardNumber(card).toLowerCase();
        const matchesName = card.name.toLowerCase().includes(q);
        const matchesNum = card.number.toLowerCase() === q || fullNum === q || card.number.toLowerCase().includes(q) || fullNum.includes(q);
        const matchesSet = card.set.name.toLowerCase().includes(q);
        if (!matchesName && !matchesNum && !matchesSet) return false;
      }

      // 2. Filtro de Raridade (campo da API)
      if (filterRarity !== 'all') {
        if (card.rarity !== filterRarity) return false;
      }

      // 3. Filtro de Set (campo da API)
      if (filterSet !== 'all') {
        if (card.set.id !== filterSet) return false;
      }

      // 4. Filtro de Categoria (Standard, Foil, etc.)
      if (filterCategory !== 'all') {
        const normalized = getNormalizedVariations(data.variations);
        const varData = normalized[filterCategory];
        const hasQty = varData && Object.values(varData).some(cond => cond.quantity > 0);
        if (!hasQty && selectedFolderId !== 'wishlist') return false;
      }

      // 5. Filtro de Qualidade/Condição (NM, SP, etc.)
      if (filterQuality !== 'all') {
        const normalized = getNormalizedVariations(data.variations);
        const hasQty = Object.values(normalized).some(conds => conds[filterQuality as CardCondition]?.quantity > 0);
        if (!hasQty && selectedFolderId !== 'wishlist') return false;
      }

      return true;
    });
  }, [activeFolderCards, searchQuery, filterRarity, filterSet, filterCategory, filterQuality, selectedFolderId]);

  // Opções para preencher os seletores com base nas cartas da pasta ativa
  const folderRarities = useMemo(() => {
    const r = activeFolderCards.map(({ card }) => card.rarity).filter(Boolean);
    return Array.from(new Set(r)).sort();
  }, [activeFolderCards]);

  const folderSets = useMemo(() => {
    const s = activeFolderCards.map(({ card }) => card.set);
    const unique = new Map<string, string>();
    s.forEach(set => unique.set(set.id, set.name));
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFolderCards]);

  // Paginação (20 por página) da lista "Todas as Cartas" da pasta ativa
  const [folderCardsPage, setFolderCardsPage] = useState(1);
  useEffect(() => {
    setFolderCardsPage(1);
  }, [filteredFolderCards]);
  const paginatedFolderCards = useMemo(() => {
    const start = (folderCardsPage - 1) * PAGE_SIZE;
    return filteredFolderCards.slice(start, start + PAGE_SIZE);
  }, [filteredFolderCards, folderCardsPage]);

  // Paginação (20 por página) da lista de cartas de uma coleção específica (modo "Coleções")
  const [setCardsPage, setSetCardsPage] = useState(1);
  useEffect(() => {
    setSetCardsPage(1);
  }, [selectedFolderSetId, filteredFolderCards]);

  // Busca/paginação dentro do modal "Gerenciar Pasta"
  const [manageSearchQuery, setManageSearchQuery] = useState('');
  const [managePage, setManagePage] = useState(1);
  const manageFilteredCards = useMemo(() => {
    if (!manageSearchQuery.trim()) return tradeCards;
    const q = manageSearchQuery.toLowerCase().trim();
    return tradeCards.filter(({ card }) => {
      const fullNum = getCompleteCardNumber(card).toLowerCase();
      return (
        card.name.toLowerCase().includes(q) ||
        card.number.toLowerCase().includes(q) ||
        fullNum.includes(q) ||
        card.set.name.toLowerCase().includes(q)
      );
    });
  }, [tradeCards, manageSearchQuery]);
  useEffect(() => {
    setManagePage(1);
  }, [manageFilteredCards]);
  const paginatedManageCards = useMemo(() => {
    const start = (managePage - 1) * PAGE_SIZE;
    return manageFilteredCards.slice(start, start + PAGE_SIZE);
  }, [manageFilteredCards, managePage]);

  // Reseta filtros e navegação ao voltar/fechar uma pasta
  const handleExitFolder = () => {
    setSelectedFolderId(null);
    setFolderViewMode('cards');
    setSelectedFolderSeries(null);
    setSelectedFolderSetId(null);
    setSearchQuery('');
    setFilterRarity('all');
    setFilterSet('all');
    setFilterCategory('all');
    setFilterQuality('all');
    setShowFolderFilters(false);
  };

  // Remove card from trade entirely (updates DB)
  const handleRemoveFromTrade = (cardId: string) => {
    onUpdateUser(updateCardStatus(user, cardId, { isForTrade: false }));
  };

  // Remove card from a custom folder (doesn't stop trading the card, just removes from custom folder)
  const handleRemoveFromFolder = (folderId: string, cardId: string) => {
    const updatedFolders = folders.map(f => {
      if (f.id === folderId) {
        return {
          ...f,
          cardIds: f.cardIds.filter(id => id !== cardId)
        };
      }
      return f;
    });
    onUpdateUser({
      ...user,
      folders: updatedFolders
    });
  };

  // Toggle card inside a folder
  const handleToggleCardInFolder = (folderId: string, cardId: string) => {
    const updatedFolders = folders.map(f => {
      if (f.id === folderId) {
        const exists = f.cardIds.includes(cardId);
        const newCardIds = exists 
          ? f.cardIds.filter(id => id !== cardId)
          : [...f.cardIds, cardId];
        return { ...f, cardIds: newCardIds };
      }
      return f;
    });
    onUpdateUser({
      ...user,
      folders: updatedFolders
    });
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;

    const newFolder: TradeFolder = {
      id: Date.now().toString(),
      name: newFolderName.trim(),
      cardIds: [],
      visibleToFriends: false
    };

    onUpdateUser({
      ...user,
      folders: [...folders, newFolder]
    });

    setNewFolderName('');
    setShowCreateFolder(false);
  };

  const handleDeleteFolder = (folderId: string) => {
    if (window.confirm("Tem certeza de que deseja excluir esta pasta? As cartas não serão removidas de suas trocas gerais.")) {
      const updatedFolders = folders.filter(f => f.id !== folderId);
      onUpdateUser({
        ...user,
        folders: updatedFolders
      });
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
    }
  };

  const handleToggleFolderVisibility = (folderId: string) => {
    const updatedFolders = folders.map(f =>
      f.id === folderId ? { ...f, visibleToFriends: !f.visibleToFriends } : f
    );
    onUpdateUser({
      ...user,
      folders: updatedFolders
    });
  };

  return (
    <div className="animate-in fade-in duration-500 px-6 max-w-lg mx-auto pb-8">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <h2 className="text-2xl text-slate-800">Central de Trocas</h2>
          <p className="text-slate-400 text-xs">Gerencie suas pastas ou explore os álbuns dos seus amigos.</p>
        </div>

        {(actionableTrades.length > 0 || activeTrades.length > 0) && (
          <button
            onClick={() => setActiveTradeModal(actionableTrades[0] || activeTrades[0])}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors ${
              actionableTrades.length > 0
                ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${actionableTrades.length > 0 ? 'text-amber-600' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>
              <span className={`text-xs font-semibold ${actionableTrades.length > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                {actionableTrades.length > 0
                  ? `${actionableTrades.length} troca(s) esperando sua resposta`
                  : `${activeTrades.length} troca(s) em andamento`}
              </span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        )}

        <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
          <button
            onClick={() => {
              setActiveTab('my');
              handleExitFolder();
              setSelectedFriend(null);
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'my' ? 'bg-white text-[#646B99] shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Minhas Pastas
          </button>
          <button
            onClick={() => {
              setActiveTab('friends');
              handleExitFolder();
              setSelectedFriend(null);
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'friends' ? 'bg-white text-[#646B99] shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Pasta de Amigos
          </button>
        </div>
      </div>

      {activeTab === 'my' ? (
        // --- MY FOLDERS SUB-VIEW ---
        selectedFolderId === null ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Pastas Ativas</span>
              <button
                onClick={() => setShowCreateFolder(true)}
                className="text-[11px] font-medium text-[#646B99] hover:text-[#4d5275] flex items-center gap-1 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg transition-colors"
              >
                + Criar Pasta
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <div className="w-6 h-6 border-2 border-[#646B99] border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">Carregando dados...</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {/* 1. Pasta de Repetidas */}
                <div 
                  onClick={() => setSelectedFolderId('duplicates')}
                  className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-white p-4 rounded-xl border border-slate-100 shadow-sm cursor-pointer hover:border-[#646B99]/30 transition-all group animate-in fade-in"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-[#646B99]/10 rounded-xl flex items-center justify-center text-[#646B99]">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Pasta de Repetidas</h3>
                      <p className="text-[10px] text-slate-400">Cartas repetidas ou para troca</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
                      {tradeCards.length}
                    </span>
                    <span className="text-[9px] bg-[#646B99]/10 text-[#646B99] px-2 py-0.5 rounded uppercase tracking-wider font-semibold">
                      Automática
                    </span>
                  </div>
                </div>

                {/* 2. Lista de Desejos */}
                <div 
                  onClick={() => setSelectedFolderId('wishlist')}
                  className="flex items-center justify-between bg-gradient-to-r from-red-50/10 to-white p-4 rounded-xl border border-slate-100 shadow-sm cursor-pointer hover:border-red-500/30 transition-all group animate-in fade-in"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center text-red-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Lista de Desejos</h3>
                      <p className="text-[10px] text-slate-400">Cartas marcadas com coração</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {loadingWishlist ? (
                      <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="text-xs bg-red-50 text-red-700 border border-red-100 px-2.5 py-1 rounded-full font-medium">
                        {wishlistCards.length}
                      </span>
                    )}
                    <span className="text-[9px] bg-red-500/10 text-red-600 px-2 py-0.5 rounded uppercase tracking-wider font-semibold">
                      Manual
                    </span>
                  </div>
                </div>

                {/* 3. Custom Folders */}
                {folders.map(folder => {
                  const validCardsCount = folder.cardIds.filter(id => 
                    tradeCards.some(tc => tc.card.id === id)
                  ).length;

                  return (
                    <div 
                      key={folder.id}
                      className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm cursor-pointer hover:border-[#646B99]/30 transition-all group animate-in fade-in"
                    >
                      <div 
                        className="flex-1 flex items-center gap-4"
                        onClick={() => setSelectedFolderId(folder.id)}
                      >
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#646B99] transition-colors">{folder.name}</h3>
                          <p className="text-[10px] text-slate-400">
                            {folder.visibleToFriends ? 'Visível para amigos' : 'Pasta de trocas personalizada'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs bg-slate-50 border border-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-medium" onClick={() => setSelectedFolderId(folder.id)}>
                          {validCardsCount}
                        </span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFolderVisibility(folder.id);
                          }}
                          className={`p-1.5 rounded-lg transition-all ${folder.visibleToFriends ? 'text-[#646B99] bg-[#646B99]/10' : 'text-slate-300 hover:text-[#646B99] hover:bg-[#646B99]/5'}`}
                          title={folder.visibleToFriends ? 'Visível para amigos (clique para ocultar)' : 'Oculta para amigos (clique para exibir)'}
                        >
                          {folder.visibleToFriends ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                          )}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFolder(folder.id);
                          }}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Excluir Pasta"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          // --- VIEWING A SPECIFIC FOLDER (duplicates, wishlist, or custom) ---
          (() => {
            const isDuplicates = selectedFolderId === 'duplicates';
            const isWishlist = selectedFolderId === 'wishlist';
            const currentFolder = (!isDuplicates && !isWishlist) ? folders.find(f => f.id === selectedFolderId) : null;
            
            if (!isDuplicates && !isWishlist && !currentFolder) {
              handleExitFolder();
              return null;
            }

            return (
              <div className="space-y-4 animate-in fade-in duration-300">
                {/* Navigation Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <button 
                    onClick={handleExitFolder}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    Voltar
                  </button>

                  <h3 className="text-sm font-semibold text-slate-700 truncate max-w-[180px]">
                    {isDuplicates ? 'Pasta de Repetidas' : isWishlist ? 'Lista de Desejos' : currentFolder?.name}
                  </h3>

                  {!isDuplicates && !isWishlist && (
                    <button
                      onClick={() => { setManageSearchQuery(''); setShowManageCards(true); }}
                      className="text-[11px] font-medium text-[#646B99] hover:bg-[#646B99]/5 border border-[#646B99]/20 px-2.5 py-1 rounded-lg transition-colors uppercase tracking-wider"
                    >
                      Gerenciar
                    </button>
                  )}
                  {(isDuplicates || isWishlist) && <div className="w-12" />}
                </div>

                {/* Folder Info Banner */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100/50 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">
                      {isDuplicates 
                        ? 'Todas as cartas que você tem mais de 1 cópia ou marcou para troca estão aqui automaticamente.'
                        : isWishlist 
                          ? 'Todas as cartas que você adicionou à sua lista clicando no ícone de coração.'
                          : 'Uma seleção de suas cartas de troca organizadas nesta pasta.'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Total nesta pasta: <span className="font-semibold text-slate-700">{activeFolderCards.length} cartas</span>
                    </p>
                  </div>
                </div>

                {/* Campo de busca interno da pasta (sempre visível) */}
                <div className="space-y-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      </span>
                      <input
                        type="text"
                        placeholder="Buscar por nome, número ou set..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-700 outline-none focus:border-[#646B99] transition-all shadow-sm"
                      />
                    </div>
                    {(folderViewMode === 'cards' || selectedFolderSetId !== null) && (
                      <button
                        onClick={() => setShowFolderFilters(!showFolderFilters)}
                        className={`px-3 py-2 border rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all ${showFolderFilters ? 'bg-[#646B99] text-white border-[#646B99]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        Filtros
                      </button>
                    )}
                  </div>

                  {/* Toggle visual: todas as cartas vs coleções */}
                  <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => {
                        setFolderViewMode('cards');
                        setSelectedFolderSeries(null);
                        setSelectedFolderSetId(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${folderViewMode === 'cards' ? 'bg-[#646B99] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Todas as Cartas
                    </button>
                    <button
                      onClick={() => {
                        setFolderViewMode('collections');
                        setSelectedFolderSeries(null);
                        setSelectedFolderSetId(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${folderViewMode === 'collections' ? 'bg-[#646B99] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      Coleções
                    </button>
                  </div>

                  {(folderViewMode === 'cards' || selectedFolderSetId !== null) && showFolderFilters && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Raridade</span>
                          <select
                            value={filterRarity}
                            onChange={(e) => setFilterRarity(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]"
                          >
                            <option value="all">Todas as Raridades</option>
                            {folderRarities.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>

                        {folderViewMode === 'cards' && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Coleção</span>
                            <select
                              value={filterSet}
                              onChange={(e) => setFilterSet(e.target.value)}
                              className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]"
                            >
                              <option value="all">Todas as Coleções</option>
                              {folderSets.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Categoria</span>
                          <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]"
                          >
                            <option value="all">Todas as Categorias</option>
                            {VARIATION_TYPES.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Qualidade</span>
                          <select
                            value={filterQuality}
                            onChange={(e) => setFilterQuality(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]"
                          >
                            <option value="all">Todas as Qualidades</option>
                            {Object.keys(CardCondition).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>

                        <div className="col-span-2 flex justify-end mt-1">
                          <button
                            onClick={() => {
                              setFilterRarity('all');
                              setFilterSet('all');
                              setFilterCategory('all');
                              setFilterQuality('all');
                              setSearchQuery('');
                            }}
                            className="text-[10px] font-semibold text-slate-400 hover:text-[#646B99] transition-colors"
                          >
                            Limpar Filtros
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                {/* Folder Rendering - Based on visual toggles */}
                {folderViewMode === 'cards' ? (
                  // --- CARDS LIST VIEW ---
                  filteredFolderCards.length === 0 ? (
                    <div className="text-center py-20 bg-slate-50 rounded-3xl border border-dashed border-slate-100">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-slate-200 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      <p className="text-slate-400 font-medium text-sm">Nenhuma carta encontrada</p>
                      <p className="text-[10px] text-slate-300 mt-1 uppercase tracking-wider">
                        Tente ajustar os filtros ou a pesquisa
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {paginatedFolderCards.map(({ card, data }) => (
                        <div key={card.id} className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                          <img
                            src={card.imageUrl}
                            onClick={() => setEditingCard(card)}
                            className="w-14 h-20 rounded-lg object-contain bg-slate-50/50 border border-slate-100/40 cursor-pointer hover:scale-105 transition-transform"
                          />

                          <div className="flex-1 min-w-0">
                            <h4
                              onClick={() => setEditingCard(card)}
                              className="text-slate-800 font-semibold truncate text-xs cursor-pointer hover:text-[#646B99] transition-colors"
                            >
                              {card.name}
                            </h4>
                            <p className="text-[9px] text-slate-400">{card.rarity} • #{getCompleteCardNumber(card)} ({card.set.name})</p>
                            
                             <div className="flex flex-wrap gap-1 mt-2">
                              {(() => {
                                const normalized = getNormalizedVariations(data.variations);
                                const badges: React.ReactNode[] = [];
                                Object.entries(normalized).forEach(([varType, conditionsObj]) => {
                                  Object.entries(conditionsObj).forEach(([cond, details]) => {
                                    if (details.quantity > 0) {
                                      const isOnlyOne = details.quantity === 1;
                                      badges.push(
                                        <span 
                                          key={`${varType}-${cond}`} 
                                          className={`px-1.5 py-0.5 border rounded text-[8px] font-medium flex items-center gap-1 ${
                                            isOnlyOne 
                                              ? 'bg-amber-50 border-amber-200 text-amber-700 font-semibold' 
                                              : 'bg-slate-50 border-slate-100 text-[#646B99]'
                                          }`}
                                        >
                                          {isOnlyOne && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />}
                                          {varType} {cond}: {details.quantity}
                                          {details.price ? ` ($${details.price})` : ''}
                                          {isOnlyOne && ' (Única!)'}
                                        </span>
                                      );
                                    }
                                  });
                                });
                                return badges.length > 0 ? badges : (
                                  <span className="px-1.5 py-0.5 border border-dashed border-slate-200 rounded text-[8px] text-slate-400 font-medium bg-slate-50/50">
                                    Não Possui
                                  </span>
                                );
                              })()}
                            </div>

                            <div className="flex items-center gap-2 mt-2">
                              <button
                                onClick={() => setEditingCard(card)}
                                className="px-2 py-0.5 bg-[#646B99]/5 hover:bg-[#646B99]/10 text-[#646B99] border border-[#646B99]/10 rounded text-[8px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                Editar Qtd / Preço
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] font-semibold text-emerald-500">
                              R${getCardEstimatedValue(data.variations).toFixed(2)}
                            </span>
                            
                            {isWishlist ? (
                              <button 
                                onClick={() => {
                                  const updatedWishlist = (user.wishlist || []).filter(id => id !== card.id);
                                  onUpdateUser({
                                    ...user,
                                    wishlist: updatedWishlist
                                  });
                                }}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Remover da lista de desejos"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                              </button>
                            ) : (
                              <button 
                                onClick={() => {
                                  if (isDuplicates) {
                                    handleRemoveFromTrade(card.id);
                                  } else if (currentFolder) {
                                    handleRemoveFromFolder(currentFolder.id, card.id);
                                  }
                                }}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title={isDuplicates ? "Remover de todas as trocas" : "Remover desta pasta"}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <Pagination page={folderCardsPage} totalPages={Math.max(1, Math.ceil(filteredFolderCards.length / PAGE_SIZE))} onPageChange={setFolderCardsPage} />
                    </div>
                  )
                ) : (
                  // --- COLLECTIONS VIEW MODE ---
                  (() => {
                    if (selectedFolderSetId !== null) {
                      // --- SHOW SET DETAILS CARD LIST ---
                      const setCardsInFolder = filteredFolderCards.filter(tc => tc.card.set.id === selectedFolderSetId);
                      return (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-100">
                            <button 
                              onClick={() => setSelectedFolderSetId(null)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                              Voltar para Coleções
                            </button>
                            <span className="text-xs text-slate-300">/</span>
                            <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">
                              {sets.find(s => s.id === selectedFolderSetId)?.name}
                            </span>
                          </div>

                          {setCardsInFolder.length === 0 ? (
                            <div className="text-center py-20 bg-slate-50 rounded-3xl border border-dashed border-slate-100">
                              <p className="text-slate-400 font-medium text-xs uppercase tracking-widest">Nenhuma carta nesta coleção</p>
                              <p className="text-[10px] text-slate-300 mt-1 uppercase tracking-wider">corresponde aos filtros ativos</p>
                            </div>
                          ) : (
                            <div className="grid gap-3">
                              {setCardsInFolder.slice((setCardsPage - 1) * PAGE_SIZE, setCardsPage * PAGE_SIZE).map(({ card, data }) => (
                                <div key={card.id} className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                                  <img 
                                    src={card.imageUrl} 
                                    onClick={() => setEditingCard(card)}
                                    className="w-14 h-20 rounded-lg object-contain bg-slate-50/50 border border-slate-100/40 cursor-pointer hover:scale-105 transition-transform" 
                                  />
                                  
                                  <div className="flex-1 min-w-0">
                                    <h4 
                                      onClick={() => setEditingCard(card)}
                                      className="text-slate-800 font-semibold truncate text-xs cursor-pointer hover:text-[#646B99] transition-colors"
                                    >
                                      {card.name}
                                    </h4>
                                    <p className="text-[9px] text-slate-400">{card.rarity} • #{getCompleteCardNumber(card)}</p>
                                    
                                     <div className="flex flex-wrap gap-1 mt-2">
                                      {(() => {
                                        const normalized = getNormalizedVariations(data.variations);
                                        const badges: React.ReactNode[] = [];
                                        Object.entries(normalized).forEach(([varType, conditionsObj]) => {
                                          Object.entries(conditionsObj).forEach(([cond, details]) => {
                                            if (details.quantity > 0) {
                                              const isOnlyOne = details.quantity === 1;
                                              badges.push(
                                                <span 
                                                  key={`${varType}-${cond}`} 
                                                  className={`px-1.5 py-0.5 border rounded text-[8px] font-medium flex items-center gap-1 ${
                                                    isOnlyOne 
                                                      ? 'bg-amber-50 border-amber-200 text-amber-700 font-semibold' 
                                                      : 'bg-slate-50 border-slate-100 text-[#646B99]'
                                                  }`}
                                                >
                                                  {isOnlyOne && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />}
                                                  {varType} {cond}: {details.quantity}
                                                  {isOnlyOne && ' (Única!)'}
                                                </span>
                                              );
                                            }
                                          });
                                        });
                                        return badges.length > 0 ? badges : (
                                          <span className="px-1.5 py-0.5 border border-dashed border-slate-200 rounded text-[8px] text-slate-400 font-medium bg-slate-50/50">
                                            Não Possui
                                          </span>
                                        );
                                      })()}
                                    </div>

                                    <div className="flex items-center gap-2 mt-2">
                                      <button
                                        onClick={() => setEditingCard(card)}
                                        className="px-2 py-0.5 bg-[#646B99]/5 hover:bg-[#646B99]/10 text-[#646B99] border border-[#646B99]/10 rounded text-[8px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                        Editar Qtd / Preço
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] font-semibold text-emerald-500">
                                      R${getCardEstimatedValue(data.variations).toFixed(2)}
                                    </span>
                                    {isWishlist ? (
                                      <button 
                                        onClick={() => {
                                          const updatedWishlist = (user.wishlist || []).filter(id => id !== card.id);
                                          onUpdateUser({
                                            ...user,
                                            wishlist: updatedWishlist
                                          });
                                        }}
                                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Remover da lista de desejos"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                      </button>
                                    ) : (
                                      <button 
                                        onClick={() => {
                                          if (isDuplicates) {
                                            handleRemoveFromTrade(card.id);
                                          } else if (currentFolder) {
                                            handleRemoveFromFolder(currentFolder.id, card.id);
                                          }
                                        }}
                                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title={isDuplicates ? "Remover de todas as trocas" : "Remover desta pasta"}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                              <Pagination page={setCardsPage} totalPages={Math.max(1, Math.ceil(setCardsInFolder.length / PAGE_SIZE))} onPageChange={setSetCardsPage} />
                            </div>
                          )}
                        </div>
                      );
                    } else if (selectedFolderSeries !== null) {
                      // --- SHOW LIST OF SETS IN ACTIVE ERA ---
                      return (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-100">
                            <button 
                              onClick={() => setSelectedFolderSeries(null)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                              Voltar para Eras
                            </button>
                            <span className="text-xs text-slate-300">/</span>
                            <span className="text-xs font-semibold text-slate-700 truncate">
                              {selectedFolderSeries}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            {sets
                              .filter(s => s.series === selectedFolderSeries)
                              .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
                              .map(set => {
                                const count = filteredFolderCards.filter(tc => tc.card.set.id === set.id).length;
                                if (count === 0 && !isWishlist) return null; // Only show sets containing cards
                                return (
                                  <button
                                    key={set.id}
                                    onClick={() => setSelectedFolderSetId(set.id)}
                                    className="flex flex-col items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#646B99]/30 transition-all group min-h-[140px]"
                                  >
                                    <div className="h-12 w-full flex items-center justify-center mb-2">
                                      <img src={set.logoUrl} className="max-h-full max-w-full object-contain filter group-hover:scale-110 transition-transform" />
                                    </div>
                                    <div className="w-full space-y-1 mt-auto text-center">
                                      <p className="text-[10px] font-medium text-slate-600 line-clamp-1 group-hover:text-[#646B99] transition-colors">
                                        {set.name}
                                      </p>
                                      <p className="text-[9px] font-semibold text-[#646B99] bg-[#646B99]/5 px-2 py-0.5 rounded-full inline-block">
                                        {count} {count === 1 ? 'carta' : 'cartas'}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      );
                    } else {
                      // --- SHOW ERAS ---
                      return (
                        <div className="space-y-4">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold text-center mb-2">Selecione a Era</p>
                          <div className="grid gap-3">
                            {eras.map(era => {
                              const count = filteredFolderCards.filter(tc => sets.find(s => s.id === tc.card.set.id)?.series === era).length;
                              if (count === 0 && !isWishlist) return null; // Hide empty eras
                              return (
                                <button
                                  key={era}
                                  onClick={() => setSelectedFolderSeries(era)}
                                  className="w-full flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#646B99]/30 transition-all group gap-4"
                                >
                                  <div className="flex items-center gap-4 flex-1">
                                    <div className="h-10 w-24 flex items-center justify-center">
                                      <img 
                                        src={getSetLogoForSeries(era)} 
                                        alt={era} 
                                        className="max-h-full max-w-full object-contain filter group-hover:scale-105 transition-all duration-300" 
                                      />
                                    </div>
                                    <div className="text-left">
                                      <h4 className="text-xs font-semibold text-slate-700">{era}</h4>
                                      <p className="text-[9px] text-slate-400">{getEraYear(era)}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold text-[#646B99] bg-[#646B99]/5 px-2.5 py-1 rounded-full border border-[#646B99]/10">
                                      {count} {count === 1 ? 'carta' : 'cartas'}
                                    </span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-300 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                  })()
                )}
              </div>
            );
          })()
        )
      ) : (
        // --- FRIENDS TAB VIEW ---
        selectedFriend === null ? (
          <div className="space-y-6">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Amigos Conectados</span>

            <div className="grid gap-3">
               {user.friends.length === 0 ? (
                 <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                   <p className="text-slate-400 text-sm">Você ainda não adicionou nenhum amigo.</p>
                   <p className="text-[10px] text-slate-300 uppercase tracking-wider mt-1">Adicione amigos pela aba Opções</p>
                 </div>
               ) : (
                 user.friends.map((friend) => (
                   <div
                     key={friend.userId}
                     onClick={() => {
                       setSelectedFriend(friend);
                       setTradeError(null);
                       setTradeSuccessMessage(null);
                     }}
                     className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 cursor-pointer hover:border-[#646B99]/30 hover:shadow-md transition-all shadow-sm group"
                   >
                     <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-xl bg-[#646B99]/10 flex items-center justify-center text-[#646B99] font-bold text-sm">
                         {friend.username[0]?.toUpperCase()}
                       </div>
                       <div>
                         <span className="text-sm font-semibold text-slate-700 group-hover:text-[#646B99] transition-colors">{friend.username}</span>
                         <p className="text-[10px] text-slate-400">Ver coleções compartilhadas</p>
                       </div>
                     </div>
                     <div className="flex items-center gap-2">
                       <span className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold">Ver Pastas</span>
                       <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-300 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                     </div>
                   </div>
                 ))
               )}
            </div>
          </div>
        ) : tradeSuccessMessage ? (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="p-10 text-center bg-emerald-50 rounded-2xl border border-emerald-100">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto text-emerald-500 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
              <p className="text-emerald-700 text-sm font-medium">{tradeSuccessMessage}</p>
              <button
                onClick={() => { setTradeSuccessMessage(null); setSelectedFriend(null); }}
                className="mt-4 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-xl hover:bg-emerald-50 transition-colors"
              >
                Voltar para amigos
              </button>
            </div>
          </div>
        ) : (
          // --- VIEWING A FRIEND'S FOLDERS: escolher cartas para pedir em troca ---
          <FriendFolderBrowser
            friendUserId={selectedFriend.userId}
            friendUsername={selectedFriend.username}
            onBack={() => setSelectedFriend(null)}
            submitLabel="Trocar"
            submitting={creatingTrade}
            helperText="Selecione as cartas que você quer pedir para essa pessoa."
            onSubmit={(folderId, items, totalValue) => setPendingTradeConfirm({ folderId, items, totalValue })}
          />
        )
      )}

      {/* --- MODAL: CONFIRMAR PEDIDO DE TROCA --- */}
      {pendingTradeConfirm && selectedFriend && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 w-full max-w-xs rounded-2xl shadow-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Confirmar Pedido de Troca</h3>
            <p className="text-[10px] text-slate-400 mb-4">
              Você está pedindo <span className="font-semibold text-slate-600">{pendingTradeConfirm.items.length} carta(s)</span> de {selectedFriend.username}.
            </p>
            <div className="bg-slate-50 rounded-xl p-4 text-center mb-4 border border-slate-100">
              <p className="text-[9px] text-slate-400 uppercase tracking-widest">Valor total</p>
              <p className="text-2xl font-bold text-[#646B99]">R${pendingTradeConfirm.totalValue.toFixed(2)}</p>
            </div>
            {tradeError && <p className="text-red-500 text-[10px] mb-3">{tradeError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingTradeConfirm(null); setTradeError(null); }}
                className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
                disabled={creatingTrade}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!pendingTradeConfirm || !selectedFriend) return;
                  setCreatingTrade(true);
                  setTradeError(null);
                  const { trade, error } = await createTradeRequest(
                    selectedFriend.userId,
                    pendingTradeConfirm.folderId,
                    pendingTradeConfirm.items
                  );
                  setCreatingTrade(false);
                  if (error) {
                    setTradeError(error);
                    return;
                  }
                  if (trade) {
                    setPendingTradeConfirm(null);
                    setTradeSuccessMessage(
                      `Pedido enviado! ${pendingTradeConfirm.items.length} carta(s) por R$${pendingTradeConfirm.totalValue.toFixed(2)}, aguardando ${selectedFriend.username}.`
                    );
                  }
                }}
                disabled={creatingTrade}
                className="flex-1 py-2 bg-[#646B99] text-white text-xs font-semibold rounded-lg hover:bg-[#4d5275] transition-colors disabled:opacity-50"
              >
                {creatingTrade ? 'Enviando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE NEW FOLDER --- */}
      {showCreateFolder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white border border-slate-100 w-full max-w-xs rounded-2xl shadow-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-1">Criar Nova Pasta</h3>
              <p className="text-[10px] text-slate-400 mb-4">Escolha um nome para organizar as cartas selecionadas.</p>
              
              <input 
                type="text" 
                placeholder="Ex: Cartas Ultra Raras, Para Sábado..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-[#646B99] mb-4"
              />
              
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setShowCreateFolder(false);
                    setNewFolderName('');
                  }}
                  className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleCreateFolder}
                  className="flex-1 py-2 bg-[#646B99] text-white text-xs font-semibold rounded-lg hover:bg-[#4d5275] transition-colors disabled:opacity-50"
                  disabled={!newFolderName.trim()}
                >
                  Criar Pasta
                </button>
              </div>
           </div>
        </div>
      )}


      {/* --- MODAL: MANAGE CARDS IN CUSTOM FOLDER --- */}
      {showManageCards && selectedFolderId && (
        (() => {
          const currentFolder = folders.find(f => f.id === selectedFolderId);
          if (!currentFolder) return null;

          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white border border-slate-100 w-full max-w-sm rounded-2xl shadow-2xl p-6 max-h-[85vh] flex flex-col">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-800">Gerenciar Pasta</h3>
                    <p className="text-[10px] text-slate-400">Selecione quais cartas marcadas para troca pertencem à pasta: <span className="font-semibold text-slate-600">{currentFolder.name}</span></p>
                  </div>

                  {tradeCards.length === 0 ? (
                    <div className="flex-1 overflow-y-auto py-10 text-center bg-slate-50 rounded-xl border border-slate-100 flex flex-col items-center justify-center">
                      <p className="text-xs text-slate-400">Você não possui nenhuma carta marcada para troca.</p>
                      <p className="text-[9px] text-slate-300 uppercase mt-1">Marque-as primeiro na aba Home</p>
                    </div>
                  ) : (
                    <>
                      <div className="relative mb-2">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input
                          type="text"
                          placeholder="Buscar por nome, número ou set..."
                          value={manageSearchQuery}
                          onChange={(e) => setManageSearchQuery(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-700 outline-none focus:border-[#646B99] transition-all"
                        />
                      </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2 max-h-[45vh]">
                      {manageFilteredCards.length === 0 ? (
                        <div className="py-10 text-center bg-slate-50 rounded-xl border border-slate-100">
                          <p className="text-xs text-slate-400">Nenhuma carta encontrada.</p>
                        </div>
                      ) : (
                      paginatedManageCards.map(({ card }) => {
                        const isInFolder = currentFolder.cardIds.includes(card.id);
                        return (
                          <div 
                            key={card.id}
                            onClick={() => handleToggleCardInFolder(currentFolder.id, card.id)}
                            className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${isInFolder ? 'border-[#646B99]/30 bg-[#646B99]/5' : 'border-slate-100 hover:bg-slate-50'}`}
                          >
                            <input 
                              type="checkbox" 
                              checked={isInFolder}
                              onChange={() => {}} // Controlled via onClick on div
                              className="w-3.5 h-3.5 text-[#646B99] border-slate-300 rounded focus:ring-[#646B99]"
                            />
                            <img src={card.imageUrl} className="w-10 h-14 object-contain rounded bg-white border border-slate-100/50" />
                            <div className="flex-1 min-w-0">
                              <h4 className="text-[11px] font-semibold text-slate-700 truncate">{card.name}</h4>
                              <p className="text-[9px] text-slate-400 truncate">{card.rarity} • #{card.number}</p>
                            </div>
                          </div>
                        );
                      })
                      )}
                    </div>
                    <Pagination page={managePage} totalPages={Math.max(1, Math.ceil(manageFilteredCards.length / PAGE_SIZE))} onPageChange={setManagePage} />
                    </>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                    <button 
                      onClick={() => setShowManageCards(false)}
                      className="w-full py-2.5 bg-[#646B99] hover:bg-[#4d5275] text-white text-xs font-semibold rounded-xl transition-colors"
                    >
                      Concluído
                    </button>
                  </div>
               </div>
            </div>
          );
        })()
      )}
      {editingCard && (
        <CardModal
          card={editingCard}
          user={user}
          onUpdateUser={onUpdateUser}
          onClose={() => setEditingCard(null)}
          showWarnings={true}
        />
      )}
      {activeTradeModal && (
        <TradeActionModal
          trade={activeTradeModal}
          myUserId={user.id}
          onClose={closeTradeModal}
          onChanged={handleTradeChanged}
        />
      )}
    </div>
  );
};

export default TradesView;
