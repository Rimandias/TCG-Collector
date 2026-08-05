import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Deck, DeckCard, User } from '../types';
import { fetchSets, fetchCardsBySet, searchCards, fetchCardVariants, resolveDecklistLines, CardVariantInfo } from '../api';
import { getCardTotalQuantity } from '../db';
import {
  MAX_DECKS,
  MAX_DECK_CARDS,
  createDeck,
  deleteDeck,
  getMyDecks,
  parseDecklistText,
  formatDecklistText,
  updateDeck,
  DeckExportCardInfo,
  categorizeCard,
  DECK_CATEGORY_ORDER,
  UI_CATEGORY_LABELS,
} from '../decks';
import CardImage from '../components/CardImage';
import CardViewModeSelector from '../components/CardViewModeSelector';
import type { CardViewMode } from '../components/CardItem';
import { getInitialCardViewMode, saveCardViewMode, getCardGridClassName } from '../viewMode';

interface DecksViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
}

// Deriva o id do set a partir do id da carta (convenção da TCGdex: "<setId>-<localId>",
// setIds observados no catálogo nunca têm hífen, só ponto - ex: "sv08.5-1").
function setIdFromCardId(cardId: string): string {
  return cardId.slice(0, cardId.lastIndexOf('-'));
}

type LegalTag = 'Standard' | 'Expanded' | null;

// Um deck só é "Standard" se TODA carta dele for legal em Standard - basta uma carta
// exigir Expanded pra o deck inteiro virar Expanded (é a regra real de torneio).
function computeLegalTag(deck: Deck, meta: Map<string, CardVariantInfo>): LegalTag {
  if (deck.cards.length === 0) return null;
  const infos = deck.cards.map((c) => meta.get(c.cardId));
  if (infos.some((i) => !i)) return null; // ainda carregando
  return infos.every((i) => i!.legal.standard) ? 'Standard' : 'Expanded';
}

const DecksView: React.FC<DecksViewProps> = ({ user, onUpdateUser }) => {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [sets, setSets] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [meta, setMeta] = useState<Map<string, CardVariantInfo>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMyDecks().then(setDecks);
    fetchSets().then((data) => setSets(data || []));
  }, []);

  // Só busca legalidade (Standard/Expanded) por carta - usado pra tag de cada deck na
  // grade. As imagens/nomes das cartas só são buscados dentro do editor de um deck aberto.
  useEffect(() => {
    if (!decks) return;
    const missing: string[] = [...new Set<string>(decks.flatMap((d) => d.cards.map((c) => c.cardId)))].filter((id) => !meta.has(id));
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => fetchCardVariants(id).then((info) => [id, info] as const))).then((entries) => {
      setMeta((prev) => {
        const next = new Map(prev);
        entries.forEach(([id, info]) => next.set(id, info));
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);

  const handleCreate = async () => {
    const name = window.prompt('Nome do deck:', 'Novo Deck');
    if (!name || !name.trim()) return;
    setBusy(true);
    const { deck, error } = await createDeck(name.trim());
    setBusy(false);
    if (error) return alert(error);
    if (deck) {
      setDecks((prev) => [...(prev || []), deck]);
      setActiveDeckId(deck.id);
    }
  };

  const handleDelete = async (deckId: string) => {
    if (!window.confirm('Excluir este deck? Essa ação não pode ser desfeita.')) return;
    setBusy(true);
    const ok = await deleteDeck(deckId);
    setBusy(false);
    if (ok) setDecks((prev) => (prev || []).filter((d) => d.id !== deckId));
  };

  const activeDeck = (decks || []).find((d) => d.id === activeDeckId) || null;

  if (activeDeck) {
    return (
      <DeckEditor
        deck={activeDeck}
        sets={sets}
        user={user}
        onUpdateUser={onUpdateUser}
        onBack={() => setActiveDeckId(null)}
        onDeckSaved={(updated) => setDecks((prev) => (prev || []).map((d) => (d.id === updated.id ? updated : d)))}
      />
    );
  }

  const emptySlots = Math.max(0, MAX_DECKS - (decks?.length || 0));

  return (
    <div className="animate-in fade-in duration-500 px-6 pb-8 pt-4">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 className="text-2xl text-slate-800">Meus Decks</h2>
          <p className="text-slate-400 text-xs">Gerencie seus decks favoritos aqui.</p>
        </div>
        <span className="text-[10px] text-slate-400 flex-shrink-0 mb-1">{decks?.length || 0}/{MAX_DECKS}</span>
      </div>

      {decks === null && <p className="text-xs text-slate-400">Carregando...</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {(decks || []).map((deck) => {
          const total = deck.cards.reduce((sum, c) => sum + c.quantity, 0);
          const complete = total === MAX_DECK_CARDS;
          const legalTag = computeLegalTag(deck, meta);
          return (
            <button
              key={deck.id}
              onClick={() => setActiveDeckId(deck.id)}
              className="relative flex items-center gap-2.5 h-[72px] bg-white border border-slate-100 rounded-2xl p-2.5 shadow-sm text-left animate-in zoom-in-95 duration-200"
            >
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(deck.id); }}
                className="absolute top-1.5 right-1.5 p-1 text-slate-300 hover:text-red-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <div className="w-9 h-9 rounded-xl bg-[#646B99]/10 flex items-center justify-center text-[#646B99] flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="18" x="5" y="3" rx="2"/><path d="M9 3v18"/></svg>
              </div>
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="text-xs font-bold text-slate-700 truncate">{deck.name}</h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                    {total}/{MAX_DECK_CARDS}
                  </span>
                  {legalTag && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${legalTag === 'Standard' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                      {legalTag}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {Array.from({ length: emptySlots }).map((_, i) => (
          <button
            key={`empty-${i}`}
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center justify-center gap-2 h-[72px] border-2 border-dashed border-slate-200 rounded-2xl text-slate-300 hover:text-[#646B99] hover:border-[#646B99] transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span className="text-[10px] font-semibold uppercase tracking-wide">Criar Deck</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Editor de um deck ---

interface DeckEditorProps {
  deck: Deck;
  sets: { id: string; name: string; code: string | null }[];
  user: User;
  onUpdateUser: (user: User) => void;
  onBack: () => void;
  onDeckSaved: (deck: Deck) => void;
}

const DeckEditor: React.FC<DeckEditorProps> = ({ deck, sets, user, onUpdateUser, onBack, onDeckSaved }) => {
  const [cards, setCards] = useState<DeckCard[]>(deck.cards);
  const [name, setName] = useState(deck.name);
  const [cardInfo, setCardInfo] = useState<Map<string, Card>>(new Map());
  const [meta, setMeta] = useState<Map<string, CardVariantInfo>>(new Map());
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);
  const [showSearch, setShowSearch] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importResult, setImportResult] = useState<{ addedCount: number; unresolved: string[] } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setsById = useMemo(() => new Map(sets.map((s) => [s.id, s])), [sets]);

  const changeViewMode = (mode: CardViewMode) => {
    setViewMode(mode);
    saveCardViewMode(mode);
  };

  // Busca os dados de exibição (nome/imagem/número) das cartas do deck - uma requisição
  // por set distinto referenciado (cacheada/dedupada em api.ts), não uma por carta.
  useEffect(() => {
    const setIds: string[] = [...new Set<string>(cards.map((c) => setIdFromCardId(c.cardId)))];
    Promise.all(setIds.map((id) => fetchCardsBySet(id))).then((results) => {
      setCardInfo((prev) => {
        const next = new Map(prev);
        results.flat().forEach((c: Card) => next.set(c.id, c));
        return next;
      });
    });
    // Categoria (Pokémon/Trainer/Energy) e legalidade só vêm do endpoint por carta -
    // buscadas só pra cartas que ainda não têm essa info.
    const missingMeta = cards.map((c) => c.cardId).filter((id) => !meta.has(id));
    if (missingMeta.length > 0) {
      Promise.all(missingMeta.map((id) => fetchCardVariants(id).then((info) => [id, info] as const))).then((entries) => {
        setMeta((prev) => {
          const next = new Map(prev);
          entries.forEach(([id, info]) => next.set(id, info));
          return next;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const totalQuantity = cards.reduce((sum, c) => sum + c.quantity, 0);

  const scheduleSave = (nextCards: DeckCard[]) => {
    setCards(nextCards);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { deck: saved, error } = await updateDeck(deck.id, { cards: nextCards });
      if (error) alert(error);
      if (saved) onDeckSaved(saved);
    }, 600);
  };

  // As quantidades aqui são as que o DECK precisa, não a coleção do usuário - nunca tocam
  // em user.ownedCards. "possui X, precisa de Y" (getCardTotalQuantity) é só exibido, o
  // usuário ajusta sua coleção de verdade na Coleção; aqui só ajusta quanto o deck pede.
  const addCard = (cardId: string, quantity: number) => {
    const existing = cards.find((c) => c.cardId === cardId);
    const nextQty = Math.min(MAX_DECK_CARDS, (existing?.quantity || 0) + quantity);
    const others = cards.filter((c) => c.cardId !== cardId);
    const othersTotal = others.reduce((sum, c) => sum + c.quantity, 0);
    if (othersTotal + nextQty > MAX_DECK_CARDS) {
      alert(`Esse deck já tem ${othersTotal} carta(s); adicionar essa quantidade passaria do limite de ${MAX_DECK_CARDS}.`);
      return;
    }
    scheduleSave([...others, { cardId, quantity: nextQty }]);
  };

  const setQuantity = (cardId: string, quantity: number) => {
    if (quantity <= 0) {
      scheduleSave(cards.filter((c) => c.cardId !== cardId));
      return;
    }
    const others = cards.filter((c) => c.cardId !== cardId);
    const othersTotal = others.reduce((sum, c) => sum + c.quantity, 0);
    if (othersTotal + quantity > MAX_DECK_CARDS) {
      alert(`Esse deck só tem espaço pra mais ${MAX_DECK_CARDS - othersTotal} carta(s).`);
      return;
    }
    scheduleSave([...others, { cardId, quantity }]);
  };

  const clearAllCards = () => {
    if (!window.confirm('Remover todas as cartas deste deck? A montagem atual será perdida.')) return;
    scheduleSave([]);
  };

  const toggleWishlist = (cardId: string) => {
    const currentWishlist = user.wishlist || [];
    const updated = currentWishlist.includes(cardId)
      ? currentWishlist.filter((id) => id !== cardId)
      : [...currentWishlist, cardId];
    onUpdateUser({ ...user, wishlist: updated });
  };

  const handleNameBlur = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === deck.name) return;
    const { deck: saved, error } = await updateDeck(deck.id, { name: trimmed });
    if (error) return alert(error);
    if (saved) onDeckSaved(saved);
  };

  const handleImport = async (text: string) => {
    const lines = parseDecklistText(text);
    if (lines.length === 0) return;
    const { resolved, unresolved } = await resolveDecklistLines(
      lines.map((l, index) => ({ index, code: l.code, number: l.number }))
    );
    let next = [...cards];
    for (const r of resolved) {
      const line = lines[r.index];
      const existing = next.find((c) => c.cardId === r.cardId);
      const nextQty = Math.min(MAX_DECK_CARDS, (existing?.quantity || 0) + line.quantity);
      next = [...next.filter((c) => c.cardId !== r.cardId), { cardId: r.cardId, quantity: nextQty }];
    }
    const total = next.reduce((sum, c) => sum + c.quantity, 0);
    if (total > MAX_DECK_CARDS) {
      alert(`A importação passaria do limite de ${MAX_DECK_CARDS} cartas (ficaria em ${total}) - ajuste a lista e tente de novo.`);
      return;
    }
    scheduleSave(next);
    setImportResult({ addedCount: resolved.length, unresolved: unresolved.map((i) => lines[i].raw) });
    setShowImport(false);
  };

  const buildExportText = (): string => {
    const infos: DeckExportCardInfo[] = cards.map((c) => {
      const card = cardInfo.get(c.cardId);
      const set = card ? setsById.get(card.set.id) : undefined;
      return {
        cardId: c.cardId,
        quantity: c.quantity,
        name: card?.name || c.cardId,
        number: card?.number || '',
        setCode: set?.code || card?.set.id.toUpperCase() || '',
        category: meta.get(c.cardId)?.category || '',
      };
    });
    return formatDecklistText(infos);
  };

  const legalTag = computeLegalTag({ ...deck, cards }, meta);
  const complete = totalQuantity === MAX_DECK_CARDS;

  const grouped = useMemo(() => {
    const buckets = new Map<string, DeckCard[]>();
    for (const c of cards) {
      const bucket = categorizeCard(meta.get(c.cardId)?.category || '');
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(c);
    }
    return [...DECK_CATEGORY_ORDER, 'Outras']
      .filter((k) => buckets.has(k))
      .map((k) => ({ key: k, label: UI_CATEGORY_LABELS[k], items: buckets.get(k)! }));
  }, [cards, meta]);

  const gridClassName = getCardGridClassName(viewMode);

  return (
    <div className="animate-in fade-in duration-500 px-6 pb-8 pt-4 space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 text-slate-500 bg-slate-50 rounded-lg border border-slate-100 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          className="flex-1 min-w-0 text-sm font-bold text-slate-700 bg-transparent outline-none border-b border-transparent focus:border-slate-200"
        />
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${complete ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
          {totalQuantity}/{MAX_DECK_CARDS}
        </span>
        {legalTag && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${legalTag === 'Standard' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
            {legalTag}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShowSearch(true)} className="text-[11px] font-semibold bg-[#646B99] text-white px-3 py-1.5 rounded-lg">+ Carta</button>
        <button onClick={() => setShowImport(true)} className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg">Colar lista</button>
        <button onClick={() => setShowExport(true)} className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg">Exportar</button>
        {cards.length > 0 && (
          <button onClick={clearAllCards} className="text-[11px] font-semibold bg-red-50 text-red-500 px-3 py-1.5 rounded-lg">Limpar tudo</button>
        )}
        <div className="ml-auto">
          <CardViewModeSelector viewMode={viewMode} onChange={changeViewMode} />
        </div>
      </div>

      <div className="space-y-4">
        {grouped.map((group) => (
          <div key={group.key}>
            <h3 className="text-[11px] font-bold text-slate-500 mb-2">
              {group.label}: {group.items.reduce((sum, c) => sum + c.quantity, 0)}
            </h3>
            <div className={gridClassName}>
              {group.items.map((dc) => (
                <DeckCardTile
                  key={dc.cardId}
                  deckCard={dc}
                  card={cardInfo.get(dc.cardId)}
                  ownedQty={getCardTotalQuantity(user.ownedCards[dc.cardId]?.variations || {})}
                  isWishlisted={(user.wishlist || []).includes(dc.cardId)}
                  viewMode={viewMode}
                  onQuantityChange={(qty) => setQuantity(dc.cardId, qty)}
                  onToggleWishlist={() => toggleWishlist(dc.cardId)}
                />
              ))}
            </div>
          </div>
        ))}
        {cards.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Deck vazio - adicione cartas ou cole uma lista.</p>}
      </div>

      {showSearch && <CardSearchModal onPick={(cardId) => addCard(cardId, 1)} onClose={() => setShowSearch(false)} />}
      {showImport && <ImportModal onImport={handleImport} onClose={() => setShowImport(false)} />}

      {importResult && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-6" onClick={() => setImportResult(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-5 max-w-xs w-full text-center space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-700">{importResult.addedCount} carta(s) importada(s).</p>
            {importResult.unresolved.length > 0 && (
              <div className="text-left text-[10px] text-red-500 bg-red-50 rounded-lg p-2 space-y-0.5">
                <p className="font-semibold">Não reconhecidas (adicione manualmente):</p>
                {importResult.unresolved.map((line, i) => <p key={i}>{line}</p>)}
              </div>
            )}
            <button onClick={() => setImportResult(null)} className="w-full bg-[#646B99] text-white text-xs font-semibold py-2 rounded-xl mt-2">OK</button>
          </div>
        </div>
      )}

      {showExport && <ExportModal text={buildExportText()} onClose={() => setShowExport(false)} />}
    </div>
  );
};

// --- Tile de uma carta dentro do deck ---
// Diferente de CardItem: o +/- aqui ajusta a quantidade que o DECK precisa, nunca a
// coleção do usuário. "possui/precisa" (ex: 2/4) mostra a diferença; ficar em preto e
// branco significa "não possui nenhuma cópia", a tag vermelha mostra quantas faltam.

interface DeckCardTileProps {
  deckCard: DeckCard;
  card: Card | undefined;
  ownedQty: number;
  isWishlisted: boolean;
  viewMode: CardViewMode;
  onQuantityChange: (quantity: number) => void;
  onToggleWishlist: () => void;
}

const DeckCardTile: React.FC<DeckCardTileProps> = ({ deckCard, card, ownedQty, isWishlisted, viewMode, onQuantityChange, onToggleWishlist }) => {
  const needed = deckCard.quantity;
  const missing = Math.max(0, needed - ownedQty);
  const isColor = ownedQty > 0;

  const WishlistButton = (
    <button
      onClick={onToggleWishlist}
      className={`p-1.5 rounded-lg transition-all ${isWishlisted ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-300 hover:text-red-500'}`}
      title={isWishlisted ? 'Remover da Lista de Desejos' : 'Adicionar à Lista de Desejos'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill={isWishlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
      </svg>
    </button>
  );

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl p-2 shadow-sm">
        <CardImage
          src={card?.imageUrl || ''}
          alt={card?.name || ''}
          className={`w-9 h-11 object-cover rounded bg-slate-100 flex-shrink-0 transition-all ${isColor ? '' : 'grayscale brightness-[0.8] opacity-50'}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-700 truncate font-medium">{card?.name || deckCard.cardId}</p>
          <p className="text-[10px] text-slate-400">{ownedQty}/{needed} {missing > 0 && <span className="text-red-500 font-semibold">· faltam {missing}</span>}</p>
        </div>
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden h-8 flex-shrink-0">
          <button onClick={() => onQuantityChange(needed - 1)} className="w-7 h-full text-slate-400 hover:text-red-500">-</button>
          <span className="w-6 text-center text-[11px] text-[#646B99] tabular-nums">{needed}</span>
          <button onClick={() => onQuantityChange(needed + 1)} className="w-7 h-full text-slate-400 hover:text-emerald-500">+</button>
        </div>
        {WishlistButton}
      </div>
    );
  }

  const isCompact = viewMode === 'grid6';

  return (
    <div className="flex flex-col gap-2 bg-white animate-in zoom-in-95 duration-200 mb-4">
      <div className="relative aspect-[2/2.8] overflow-hidden rounded-md shadow-sm border border-slate-100">
        <CardImage
          src={card?.imageUrl || ''}
          alt={card?.name || ''}
          className={`w-full h-full object-cover transition-all duration-500 ${isColor ? 'grayscale-0' : 'grayscale brightness-[0.8] opacity-40'} ${!card?.imageUrl ? 'bg-slate-100' : ''}`}
        />
        {missing > 0 && (
          <div className="absolute top-1 left-1 min-w-[18px] h-[18px] px-1 bg-red-500 rounded-full flex items-center justify-center shadow-md border border-white" title={`Faltam ${missing} cópia(s)`}>
            <span className="text-[9px] font-bold text-white leading-none">-{missing}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className={`flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden shadow-sm ${isCompact ? 'h-7' : 'h-8'}`}>
          <div className="flex items-center flex-1 justify-between px-1 h-full">
            <button onClick={() => onQuantityChange(needed - 1)} className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-red-500">-</button>
            <span className={`text-[#646B99] tabular-nums ${isCompact ? 'text-[9px]' : 'text-[10px]'}`}>{ownedQty}/{needed}</span>
            <button onClick={() => onQuantityChange(needed + 1)} className="w-6 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500">+</button>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col overflow-hidden flex-1">
            <h4 className="text-[8px] text-slate-700 truncate uppercase tracking-tight leading-none">{card?.name || deckCard.cardId}</h4>
            <span className="text-[7px] text-slate-400 mt-0.5 font-mono">{card?.number || ''}</span>
          </div>
          {WishlistButton}
        </div>
      </div>
    </div>
  );
};

// --- Modais auxiliares ---

const CardSearchModal: React.FC<{ onPick: (cardId: string) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchCards(q).then(setResults);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4 w-full sm:max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar carta pelo nome..."
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-[#646B99] mb-3"
        />
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => { onPick(card.id); onClose(); }}
              className="w-full flex items-center gap-2 bg-slate-50 hover:bg-slate-100 rounded-xl p-2 text-left"
            >
              <CardImage src={card.imageUrl} alt={card.name} className="w-8 h-11 object-cover rounded bg-white flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-slate-700 truncate font-medium">{card.name}</p>
                <p className="text-[9px] text-slate-400">{card.set?.name} · #{card.number}</p>
              </div>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full bg-slate-100 text-slate-600 text-xs font-semibold py-2 rounded-xl">Fechar</button>
      </div>
    </div>
  );
};

const ImportModal: React.FC<{ onImport: (text: string) => void; onClose: () => void }> = ({ onImport, onClose }) => {
  const [text, setText] = useState('');
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold text-slate-700">Cole a lista do deck</p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Pokémon: 18\n4 Beldum TEF 113\n...'}
          rows={10}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono outline-none focus:ring-1 focus:ring-[#646B99]"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 text-xs font-semibold py-2 rounded-xl">Cancelar</button>
          <button onClick={() => onImport(text)} className="flex-1 bg-[#646B99] text-white text-xs font-semibold py-2 rounded-xl">Importar</button>
        </div>
      </div>
    </div>
  );
};

const ExportModal: React.FC<{ text: string; onClose: () => void }> = ({ text, onClose }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold text-slate-700">Lista do deck</p>
        <textarea readOnly value={text} rows={12} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-slate-100 text-slate-600 text-xs font-semibold py-2 rounded-xl">Fechar</button>
          <button
            onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="flex-1 bg-[#646B99] text-white text-xs font-semibold py-2 rounded-xl"
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DecksView;
