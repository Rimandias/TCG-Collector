import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User, Card, UserCardData, TradeFolder, TradeFolderVariationSelection, Friend, Trade, CardCondition, VARIATION_TYPES, LANGUAGE_OPTIONS } from '../types';
import { updateCardStatus, getNormalizedVariations, getCardTotalQuantity, getInitialCardData, getCompleteCardNumber, getCardEstimatedValue } from '../db';
import { fetchCardsBySet, fetchSets } from '../api';
import { createTradeRequest, getMyTrades, TradeItemSelection } from '../trades';
import { redeemAccessCode } from '../premium';
import { fetchCurrentUser } from '../auth';
import CardModal from '../components/CardModal';
import FriendFolderBrowser from '../components/FriendFolderBrowser';
import TradeActionModal from '../components/TradeActionModal';
import TradeItemsList from '../components/TradeItemsList';
import Pagination, { PAGE_SIZE } from '../components/Pagination';

const TRADE_POLL_INTERVAL_MS = 15000;

// ID fixo da pasta "Pasta de Repetidas" (a mesma pasta automática exibida no topo de
// Minhas Pastas) - agora também é uma pasta real persistida (ver efeito de sincronização
// abaixo), pra poder ficar visível para amigos como qualquer outra. Ela não tem botão de
// excluir na UI e sua lista de cartas é sempre recalculada automaticamente, nunca editada
// manualmente pelo usuário.
const DEFAULT_FOLDER_ID = 'default';

const languageLabel = (code?: string) => (!code ? null : (LANGUAGE_OPTIONS.find(l => l.code === code)?.label || code));

// Mesma regra usada para popular a "Pasta de Repetidas": cartas marcadas para troca ou com
// mais de 1 cópia em alguma variação/condição.
function computeAutoTradeCardIds(ownedCards: Record<string, UserCardData>): string[] {
  return Object.entries(ownedCards)
    .filter(([_, data]) => {
      const normalized = getNormalizedVariations(data.variations);
      const hasDuplicate = Object.values(normalized).some(conditionsObj =>
        Object.values(conditionsObj).some(details => details.quantity > 1)
      );
      return data.isForTrade || hasDuplicate;
    })
    .map(([id]) => id);
}

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
  // Trocas ainda está em teste fechado - liberada por código de acesso (ver premium.ts)
  const [accessCode, setAccessCode] = useState('');
  const [redeemSubmitting, setRedeemSubmitting] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCode.trim()) return;
    setRedeemSubmitting(true);
    setRedeemError(null);
    const { user: updatedUser, error } = await redeemAccessCode(accessCode);
    setRedeemSubmitting(false);
    if (error) {
      setRedeemError(error);
      return;
    }
    if (updatedUser) onUpdateUser(updatedUser);
  };

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

  // Fila: quando mais de uma troca precisa da minha ação ao mesmo tempo (ex: dois amigos
  // pediram cartas da mesma pasta), a mais antiga (quem pediu primeiro) aparece primeiro.
  const actionableTrades = useMemo(
    () =>
      myTrades
        .filter((t) => needsMyAction(t, user.id) && !dismissedTradeIds.has(t.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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

  // Mantém o pop-up aberto sincronizado com o polling: sem isso, o modal ficava "congelado"
  // com os dados de quando foi aberto, mesmo depois da outra pessoa confirmar e a troca
  // avançar (ex.: usuário via "Aguardando confirmação" indefinidamente mesmo já concluída).
  useEffect(() => {
    setActiveTradeModal((current) => {
      if (!current) return current;
      const fresh = myTrades.find((t) => t.id === current.id);
      if (!fresh) return current;
      if (fresh.status === current.status && fresh.updatedAt === current.updatedAt) return current;
      if (fresh.status === 'completed' && current.status !== 'completed') {
        fetchCurrentUser().then((freshUser) => {
          if (freshUser) onUpdateUser(freshUser);
        });
      }
      if (fresh.status === 'cancelled') return null;
      return fresh;
    });
  }, [myTrades]);

  const handleTradeChanged = async (updated: Trade) => {
    setMyTrades((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    if (updated.status === 'cancelled') {
      setActiveTradeModal(null);
      return;
    }
    // Em 'completed' mantemos o pop-up aberto (sem auto-close) para o usuário ver
    // quais cartas foram trocadas antes de fechar manualmente e ajustar a pasta física.
    setActiveTradeModal(updated);
    if (updated.status === 'completed') {
      const freshUser = await fetchCurrentUser();
      if (freshUser) onUpdateUser(freshUser);
    }
  };

  const closeTradeModal = () => {
    if (activeTradeModal) {
      setDismissedTradeIds((prev) => new Set(prev).add(activeTradeModal.id));
    }
    setActiveTradeModal(null);
  };

  // --- Histórico de Trocas (dentro do toggle "Pasta de Amigos") ---
  const [friendsSubTab, setFriendsSubTab] = useState<'friends' | 'history'>('friends');
  const [historyCardsById, setHistoryCardsById] = useState<Record<string, Card>>({});
  const [loadingHistoryCards, setLoadingHistoryCards] = useState(false);

  const historyTrades = useMemo(
    () =>
      myTrades
        .filter((t) => t.status === 'completed' || t.status === 'cancelled')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [myTrades]
  );

  // Carrega os dados das cartas do histórico só quando o usuário abre essa aba (evita
  // requisições desnecessárias de todas as coleções toda vez que a tela de trocas monta).
  useEffect(() => {
    if (friendsSubTab !== 'history' || historyTrades.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const allCardIds: string[] = Array.from(
        new Set(historyTrades.flatMap((t) => [...t.requestedItems, ...t.offeredItems].map((i) => i.cardId)))
      );
      const missingIds = allCardIds.filter((id) => !historyCardsById[id]);
      if (missingIds.length === 0) return;
      setLoadingHistoryCards(true);
      const setIds: string[] = Array.from(new Set(missingIds.map((id) => id.split('-')[0])));
      const map: Record<string, Card> = {};
      await Promise.all(
        setIds.map(async (setId) => {
          try {
            const cards = await fetchCardsBySet(setId);
            for (const card of cards) map[card.id] = card;
          } catch {
            // Ignora falhas isoladas de coleção
          }
        })
      );
      if (!cancelled) {
        setHistoryCardsById((prev) => ({ ...prev, ...map }));
        setLoadingHistoryCards(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [friendsSubTab, historyTrades]);

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showManageCards, setShowManageCards] = useState(false);
  const [variationPickerCardId, setVariationPickerCardId] = useState<string | null>(null);
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

  // Mantém a "Pasta de Repetidas" sempre existindo como uma pasta real (visível para
  // amigos, ver getVisibleFolders no backend) com a lista de cartas sincronizada com a
  // regra automática (isForTrade ou mais de 1 cópia) - o usuário nunca edita isso na mão,
  // só via Home ("Colocar Todas Para Troca") ou marcando cartas individualmente.
  useEffect(() => {
    const idealIds = computeAutoTradeCardIds(user.ownedCards);
    const existing = (user.folders || []).find(f => f.id === DEFAULT_FOLDER_ID);
    const currentSet = new Set(existing?.cardIds || []);
    const sameMembership = !!existing && idealIds.length === currentSet.size && idealIds.every(id => currentSet.has(id));
    if (sameMembership) return;

    const nextFolders = existing
      ? (user.folders || []).map(f => (f.id === DEFAULT_FOLDER_ID ? { ...f, cardIds: idealIds } : f))
      : [
          ...(user.folders || []),
          { id: DEFAULT_FOLDER_ID, name: 'Pasta de Repetidas', cardIds: idealIds, visibleToFriends: true },
        ];
    onUpdateUser({ ...user, folders: nextFolders });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.ownedCards]);

  // IDs das cartas que o usuário possui (quantidade > 0 em alguma variação/condição), usado
  // para destacar na pasta do amigo quais cartas eu ainda não tenho.
  const myOwnedCardIds = useMemo(
    () => Object.keys(user.ownedCards).filter(id => getCardTotalQuantity(user.ownedCards[id]?.variations) > 0),
    [user.ownedCards]
  );

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

  // Carrega os metadados das coleções (leve, uma única chamada) sempre.
  useEffect(() => {
    fetchSets().then((setsList) => {
      if (setsList) setSets(setsList);
    });
  }, []);

  // Carrega as cartas da Lista de Desejos: busca somente as coleções realmente referenciadas
  // pelo wishlist do usuário (via prefixo do cardId), em vez de TODAS as ~200 coleções do
  // catálogo. Buscar tudo a cada montagem da tela de Trocas gerava dezenas/centenas de
  // requisições concorrentes desnecessárias, deixando toda a aplicação lenta (inclusive
  // travando por vários segundos outras chamadas importantes, como carregar as trocas).
  useEffect(() => {
    const loadWishlistCards = async () => {
      const wishlistIds = user.wishlist || [];
      const neededSetIds: string[] = Array.from(new Set(wishlistIds.map((id) => id.split('-')[0])));
      if (neededSetIds.length === 0) {
        setAllSetCards([]);
        return;
      }
      setLoadingWishlist(true);
      try {
        const allCards: Card[] = [];
        await Promise.all(
          neededSetIds.map(async (setId) => {
            try {
              const cards = await fetchCardsBySet(setId);
              allCards.push(...cards);
            } catch (e) {
              // Ignora falhas isoladas de coleção; a carta some da lista de desejos exibida
            }
          })
        );
        setAllSetCards(allCards);
      } finally {
        setLoadingWishlist(false);
      }
    };
    loadWishlistCards();
  }, [user.wishlist]);

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
    // Prefere a coleção-base com o mesmo nome da era, em vez da mais antiga por data de
    // lançamento — os "X Black Star Promos" costumam sair no mesmo dia ou antes da coleção
    // base e "venciam" o sort por data, mostrando o logo do promo em vez do oficial.
    const baseSet = seriesSets.find(s => s.name.trim().toLowerCase() === seriesName.trim().toLowerCase());
    if (baseSet) return baseSet.logoUrl || '';
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
        const matchesArtist = (card.artist || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNum && !matchesSet && !matchesArtist) return false;
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
        card.set.name.toLowerCase().includes(q) ||
        (card.artist || '').toLowerCase().includes(q)
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

  // Toggle "Todas as Cartas" vs "Coleções" dentro do modal "Gerenciar Pasta"
  const [manageViewMode, setManageViewMode] = useState<'cards' | 'collections'>('cards');
  const [manageSelectedSeries, setManageSelectedSeries] = useState<string | null>(null);
  const [manageSelectedSetId, setManageSelectedSetId] = useState<string | null>(null);

  const manageSetCardsInSet = useMemo(() => {
    if (!manageSelectedSetId) return [];
    return manageFilteredCards.filter(({ card }) => card.set.id === manageSelectedSetId);
  }, [manageFilteredCards, manageSelectedSetId]);
  useEffect(() => {
    setManagePage(1);
  }, [manageSelectedSetId]);

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
        const variationSelections = { ...(f.variationSelections || {}) };
        delete variationSelections[cardId];
        return {
          ...f,
          cardIds: f.cardIds.filter(id => id !== cardId),
          variationSelections
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
        const variationSelections = { ...(f.variationSelections || {}) };
        if (exists) delete variationSelections[cardId];
        return { ...f, cardIds: newCardIds, variationSelections };
      }
      return f;
    });
    onUpdateUser({
      ...user,
      folders: updatedFolders
    });
  };

  // Retorna as seleções de variação/condição/quantidade atuais de uma carta numa pasta.
  // Sem seleção configurada, cartas já presentes na pasta (formato antigo) contam como
  // "todas as combinações selecionadas por completo", para manter compatibilidade.
  const getFolderCardSelections = (
    folder: TradeFolder,
    cardId: string,
    entries: { variation: string; condition: CardCondition; language?: string; quantity: number }[]
  ): TradeFolderVariationSelection[] => {
    const existing = folder.variationSelections?.[cardId];
    if (existing) return existing;
    if (folder.cardIds.includes(cardId)) {
      return entries.map(e => ({ variation: e.variation, condition: e.condition, language: e.language, quantity: e.quantity }));
    }
    return [];
  };

  // Define as combinações variação/condição/quantidade selecionadas de uma carta numa pasta.
  // Selecionar ao menos uma combinação adiciona a carta à pasta; zerar as seleções a remove.
  const handleSetVariationSelections = (folderId: string, cardId: string, selections: TradeFolderVariationSelection[]) => {
    const updatedFolders = folders.map(f => {
      if (f.id !== folderId) return f;
      const variationSelections = { ...(f.variationSelections || {}) };
      if (selections.length > 0) {
        variationSelections[cardId] = selections;
        const cardIds = f.cardIds.includes(cardId) ? f.cardIds : [...f.cardIds, cardId];
        return { ...f, cardIds, variationSelections };
      }
      delete variationSelections[cardId];
      return { ...f, cardIds: f.cardIds.filter(id => id !== cardId), variationSelections };
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
    if (folderId === DEFAULT_FOLDER_ID) return; // Pasta de Repetidas não pode ser excluída
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

  if (!user.isPremium) {
    return (
      <div className="animate-in fade-in duration-500 px-8 pt-16 pb-10 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-16 h-16 bg-[#646B99]/10 text-[#646B99] rounded-full flex items-center justify-center mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h2 className="text-lg text-slate-800 tracking-tight">Trocas em teste fechado</h2>
        <p className="text-slate-400 text-xs mt-2 leading-relaxed">
          Essa funcionalidade ainda está em fase de testes. Se você recebeu um código de acesso, digite abaixo para liberar as Trocas na sua conta.
        </p>

        <form onSubmit={handleRedeemCode} className="w-full mt-8 space-y-3">
          <input
            type="text"
            placeholder="CÓDIGO DE ACESSO"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs tracking-widest text-slate-900 text-center outline-none focus:border-[#646B99] transition-colors uppercase"
          />
          {redeemError && (
            <p className="text-red-500 text-[10px] uppercase tracking-widest">{redeemError}</p>
          )}
          <button
            type="submit"
            disabled={redeemSubmitting || !accessCode.trim()}
            className="w-full py-4 bg-slate-900 text-white text-xs rounded-full hover:bg-slate-800 transition-all shadow-xl uppercase tracking-[0.3em] disabled:opacity-50"
          >
            {redeemSubmitting ? 'Verificando...' : 'Liberar Acesso'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 px-6 max-w-lg mx-auto pb-8 pt-4">
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
              setFriendsSubTab('friends');
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
                      <p className="text-[10px] text-slate-400">
                        {folders.find(f => f.id === DEFAULT_FOLDER_ID)?.visibleToFriends ? 'Visível para amigos' : 'Cartas repetidas ou para troca'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
                      {tradeCards.length}
                    </span>
                    <span className="text-[9px] bg-[#646B99]/10 text-[#646B99] px-2 py-0.5 rounded uppercase tracking-wider font-semibold">
                      Automática
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFolderVisibility(DEFAULT_FOLDER_ID);
                      }}
                      className={`p-1.5 rounded-lg transition-all ${folders.find(f => f.id === DEFAULT_FOLDER_ID)?.visibleToFriends ? 'text-[#646B99] bg-[#646B99]/10' : 'text-slate-300 hover:text-[#646B99] hover:bg-[#646B99]/5'}`}
                      title={folders.find(f => f.id === DEFAULT_FOLDER_ID)?.visibleToFriends ? 'Visível para amigos (clique para ocultar)' : 'Oculta para amigos (clique para exibir)'}
                    >
                      {folders.find(f => f.id === DEFAULT_FOLDER_ID)?.visibleToFriends ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                      )}
                    </button>
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
                {folders.filter(folder => folder.id !== DEFAULT_FOLDER_ID).map(folder => {
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
                      onClick={() => {
                        setManageSearchQuery('');
                        setManageViewMode('cards');
                        setManageSelectedSeries(null);
                        setManageSelectedSetId(null);
                        setShowManageCards(true);
                      }}
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
                                          {details.price ? ` (R$${details.price})` : ''}
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
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button
                onClick={() => setFriendsSubTab('friends')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${friendsSubTab === 'friends' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Amigos
              </button>
              <button
                onClick={() => setFriendsSubTab('history')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${friendsSubTab === 'history' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Histórico de Trocas
              </button>
            </div>

            {friendsSubTab === 'friends' ? (
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
            ) : (
              // --- HISTÓRICO DE TROCAS: trocas concluídas ou canceladas ---
              <div className="space-y-3">
                {historyTrades.length === 0 ? (
                  <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                    <p className="text-slate-400 text-sm">Nenhuma troca concluída ou cancelada ainda.</p>
                  </div>
                ) : (
                  <>
                    {loadingHistoryCards && (
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest text-center">Carregando detalhes das cartas...</p>
                    )}
                    {historyTrades.map((trade) => {
                      const isInitiator = trade.initiatorId === user.id;
                      const counterpartName = isInitiator ? trade.recipientUsername : trade.initiatorUsername;
                      const isCompleted = trade.status === 'completed';
                      const iGave = isInitiator ? trade.offeredItems : trade.requestedItems;
                      const iReceived = isInitiator ? trade.requestedItems : trade.offeredItems;
                      const diff = trade.requestedValue - trade.offeredValue;

                      return (
                        <div key={trade.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-700">Troca com {counterpartName}</p>
                              <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">
                                {new Date(trade.updatedAt).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                            <span className={`text-[9px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full ${isCompleted ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                              {isCompleted ? 'Concluída' : 'Cancelada'}
                            </span>
                          </div>

                          {isCompleted ? (
                            <>
                              {iGave.length > 0 && (
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-red-500 font-semibold mb-1.5">Você entregou</p>
                                  <TradeItemsList items={iGave} cardsById={historyCardsById} />
                                </div>
                              )}
                              {iReceived.length > 0 && (
                                <div>
                                  <p className="text-[9px] uppercase tracking-widest text-emerald-600 font-semibold mb-1.5">Você recebeu</p>
                                  <TradeItemsList items={iReceived} cardsById={historyCardsById} />
                                </div>
                              )}
                              {diff !== 0 && iGave.length === 0 && !isInitiator && (
                                <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2.5">Você recebeu R${Math.abs(diff).toFixed(2)} em dinheiro.</p>
                              )}
                              {diff !== 0 && iGave.length === 0 && isInitiator && (
                                <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2.5">Você pagou R${Math.abs(diff).toFixed(2)} em dinheiro.</p>
                              )}
                            </>
                          ) : (
                            <div>
                              <p className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold mb-1.5">Cartas pedidas (não concretizado)</p>
                              <TradeItemsList items={trade.requestedItems} cardsById={historyCardsById} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
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
            myOwnedCardIds={myOwnedCardIds}
            myWishlist={user.wishlist || []}
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

          const renderManageRow = ({ card, data }: { card: Card, data: UserCardData }) => {
            const isInFolder = currentFolder.cardIds.includes(card.id);
            const normalized = getNormalizedVariations(data.variations);
            const entries: { variation: string; condition: CardCondition; language?: string; quantity: number }[] = [];
            Object.entries(normalized).forEach(([varType, conditionsObj]) => {
              Object.entries(conditionsObj).forEach(([cond, details]) => {
                const languages = details.languages;
                if (languages && Object.keys(languages).length > 0) {
                  Object.entries(languages).forEach(([lang, langDetails]) => {
                    if (langDetails.quantity > 0) {
                      entries.push({ variation: varType, condition: cond as CardCondition, language: lang, quantity: langDetails.quantity });
                    }
                  });
                  return;
                }
                if (details.quantity > 0) {
                  entries.push({ variation: varType, condition: cond as CardCondition, quantity: details.quantity });
                }
              });
            });
            const entryKey = (e: { variation: string; condition: string; language?: string }) => `${e.variation}-${e.condition}-${e.language || ''}`;
            const badges = entries.map(e => {
              const isOnlyOne = e.quantity === 1;
              const langLabel = languageLabel(e.language);
              return (
                <span
                  key={entryKey(e)}
                  className={`px-1.5 py-0.5 border rounded text-[8px] font-medium flex items-center gap-1 ${
                    isOnlyOne
                      ? 'bg-amber-50 border-amber-200 text-amber-700 font-semibold'
                      : 'bg-slate-50 border-slate-100 text-[#646B99]'
                  }`}
                >
                  {isOnlyOne && <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />}
                  {e.variation} {e.condition}{langLabel ? ` (${langLabel})` : ''}: {e.quantity}
                  {isOnlyOne && ' (Única!)'}
                </span>
              );
            });
            const hasMultipleCombos = entries.length > 1;
            const isPickerOpen = variationPickerCardId === card.id;
            const selections = getFolderCardSelections(currentFolder, card.id, entries);

            const toggleEntry = (entry: { variation: string; condition: CardCondition; language?: string; quantity: number }) => {
              const idx = selections.findIndex(s => s.variation === entry.variation && s.condition === entry.condition && (s.language || '') === (entry.language || ''));
              const updated = idx >= 0
                ? selections.filter((_, i) => i !== idx)
                : [...selections, { variation: entry.variation, condition: entry.condition, language: entry.language, quantity: entry.quantity }];
              handleSetVariationSelections(currentFolder.id, card.id, updated);
            };

            const updateEntryQuantity = (entry: { variation: string; condition: CardCondition; language?: string; quantity: number }, quantity: number) => {
              const capped = Math.max(1, Math.min(quantity, entry.quantity));
              const idx = selections.findIndex(s => s.variation === entry.variation && s.condition === entry.condition && (s.language || '') === (entry.language || ''));
              const updated = idx >= 0
                ? selections.map((s, i) => i === idx ? { ...s, quantity: capped } : s)
                : [...selections, { variation: entry.variation, condition: entry.condition, language: entry.language, quantity: capped }];
              handleSetVariationSelections(currentFolder.id, card.id, updated);
            };

            return (
              <div
                key={card.id}
                className={`rounded-xl border transition-all ${isInFolder ? 'border-[#646B99]/30 bg-[#646B99]/5' : 'border-slate-100 hover:bg-slate-50'}`}
              >
                <div
                  onClick={() => {
                    if (hasMultipleCombos) {
                      setVariationPickerCardId(prev => prev === card.id ? null : card.id);
                    } else {
                      handleToggleCardInFolder(currentFolder.id, card.id);
                    }
                  }}
                  className="flex items-center gap-3 p-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isInFolder}
                    onChange={() => {}} // Controlled via onClick
                    className="w-3.5 h-3.5 text-[#646B99] border-slate-300 rounded focus:ring-[#646B99]"
                  />
                  <img src={card.imageUrl} className="w-10 h-14 object-contain rounded bg-white border border-slate-100/50 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-semibold text-slate-700 truncate">{card.name}</h4>
                    <p className="text-[9px] text-slate-400 truncate">{card.rarity} • #{card.number}</p>
                    {badges.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{badges}</div>}
                  </div>
                  {hasMultipleCombos && (
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  )}
                </div>

                {hasMultipleCombos && isPickerOpen && (
                  <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-slate-100/70 pt-2 animate-in slide-in-from-top-1 duration-150">
                    <p className="text-[8px] text-slate-400 uppercase tracking-widest">Selecione variação/condição e quantidade:</p>
                    {entries.map(entry => {
                      const sel = selections.find(s => s.variation === entry.variation && s.condition === entry.condition && (s.language || '') === (entry.language || ''));
                      const checked = !!sel;
                      const langLabel = languageLabel(entry.language);
                      return (
                        <div key={entryKey(entry)} className="flex items-center gap-2 bg-white border border-slate-100 rounded-lg p-1.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEntry(entry)}
                            className="w-3.5 h-3.5 text-[#646B99] border-slate-300 rounded focus:ring-[#646B99] flex-shrink-0"
                          />
                          <span className="text-[10px] text-slate-600 flex-1 min-w-0 truncate">
                            {entry.variation} {entry.condition}{langLabel ? ` · ${langLabel}` : ''} <span className="text-slate-300">(possui {entry.quantity})</span>
                          </span>
                          {checked && (
                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden h-6 flex-shrink-0">
                              <button
                                onClick={() => updateEntryQuantity(entry, (sel?.quantity || 1) - 1)}
                                className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-6 text-center text-[10px] text-[#646B99] font-semibold tabular-nums">
                                {sel?.quantity}
                              </span>
                              <button
                                onClick={() => updateEntryQuantity(entry, (sel?.quantity || 1) + 1)}
                                className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors font-bold text-xs"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          };

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

                      <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100 mb-2">
                        <button
                          onClick={() => { setManageViewMode('cards'); setManageSelectedSeries(null); setManageSelectedSetId(null); }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all ${manageViewMode === 'cards' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Todas as Cartas
                        </button>
                        <button
                          onClick={() => { setManageViewMode('collections'); setManageSelectedSeries(null); setManageSelectedSetId(null); }}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-all ${manageViewMode === 'collections' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Coleções
                        </button>
                      </div>

                    {manageViewMode === 'cards' ? (
                      <>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2 max-h-[45vh]">
                          {manageFilteredCards.length === 0 ? (
                            <div className="py-10 text-center bg-slate-50 rounded-xl border border-slate-100">
                              <p className="text-xs text-slate-400">Nenhuma carta encontrada.</p>
                            </div>
                          ) : (
                            paginatedManageCards.map(renderManageRow)
                          )}
                        </div>
                        <Pagination page={managePage} totalPages={Math.max(1, Math.ceil(manageFilteredCards.length / PAGE_SIZE))} onPageChange={setManagePage} />
                      </>
                    ) : manageSelectedSetId !== null ? (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            onClick={() => setManageSelectedSetId(null)}
                            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                            Voltar
                          </button>
                          <span className="text-slate-300 text-[10px]">/</span>
                          <span className="text-[10px] font-semibold text-slate-700 truncate">
                            {sets.find(s => s.id === manageSelectedSetId)?.name}
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2 max-h-[40vh]">
                          {manageSetCardsInSet.length === 0 ? (
                            <div className="py-10 text-center bg-slate-50 rounded-xl border border-slate-100">
                              <p className="text-xs text-slate-400">Nenhuma carta encontrada.</p>
                            </div>
                          ) : (
                            manageSetCardsInSet.slice((managePage - 1) * PAGE_SIZE, managePage * PAGE_SIZE).map(renderManageRow)
                          )}
                        </div>
                        <Pagination page={managePage} totalPages={Math.max(1, Math.ceil(manageSetCardsInSet.length / PAGE_SIZE))} onPageChange={setManagePage} />
                      </>
                    ) : manageSelectedSeries !== null ? (
                      <div className="flex-1 overflow-y-auto my-2 max-h-[45vh]">
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            onClick={() => setManageSelectedSeries(null)}
                            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                            Voltar para Eras
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {sets
                            .filter(s => s.series === manageSelectedSeries)
                            .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
                            .map(set => {
                              const count = manageFilteredCards.filter(({ card }) => card.set.id === set.id).length;
                              if (count === 0) return null;
                              return (
                                <button
                                  key={set.id}
                                  onClick={() => setManageSelectedSetId(set.id)}
                                  className="flex flex-col items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:border-[#646B99]/30 transition-all min-h-[110px]"
                                >
                                  <div className="h-9 w-full flex items-center justify-center mb-1">
                                    <img src={set.logoUrl} className="max-h-full max-w-full object-contain" />
                                  </div>
                                  <p className="text-[9px] font-medium text-slate-600 line-clamp-1 text-center">{set.name}</p>
                                  <p className="text-[8px] font-semibold text-[#646B99] bg-[#646B99]/5 px-1.5 py-0.5 rounded-full mt-1">
                                    {count} {count === 1 ? 'carta' : 'cartas'}
                                  </p>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto space-y-2 my-2 max-h-[45vh]">
                        {eras.map(era => {
                          const count = manageFilteredCards.filter(({ card }) => sets.find(s => s.id === card.set.id)?.series === era).length;
                          if (count === 0) return null;
                          return (
                            <button
                              key={era}
                              onClick={() => setManageSelectedSeries(era)}
                              className="w-full flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm hover:border-[#646B99]/30 transition-all"
                            >
                              <span className="text-[11px] font-semibold text-slate-700">{era}</span>
                              <span className="text-[9px] font-semibold text-[#646B99] bg-[#646B99]/5 px-2 py-0.5 rounded-full border border-[#646B99]/10">
                                {count} {count === 1 ? 'carta' : 'cartas'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    </>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      onClick={() => { setShowManageCards(false); setVariationPickerCardId(null); }}
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
          myOwnedCardIds={myOwnedCardIds}
          myWishlist={user.wishlist || []}
          onClose={closeTradeModal}
          onChanged={handleTradeChanged}
          onStartNewTrade={() => {
            closeTradeModal();
            setActiveTab('friends');
            setFriendsSubTab('friends');
            setSelectedFriend(null);
          }}
        />
      )}
    </div>
  );
};

export default TradesView;
