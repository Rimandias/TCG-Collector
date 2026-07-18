import React, { useEffect, useMemo, useState } from 'react';
import { Card, PokemonSet, VisibleFolder } from '../types';
import { getCompleteCardNumber } from '../db';
import { fetchCardsBySet, fetchSets } from '../api';
import { getFriendVisibleFolders, TradeItemSelection } from '../trades';
import Pagination, { PAGE_SIZE } from './Pagination';

interface FriendFolderBrowserProps {
  friendUserId: string;
  friendUsername: string;
  onBack: () => void;
  submitLabel: string;
  onSubmit: (folderId: string, items: TradeItemSelection[], totalValue: number) => void | Promise<void>;
  submitting?: boolean;
  helperText?: string;
}

interface ResolvedLine {
  cardId: string;
  card: Card | null;
  variation: string;
  condition: string;
  availableQuantity: number;
  price: number;
}

const selectionKey = (cardId: string, variation: string, condition: string) => `${cardId}__${variation}__${condition}`;

const FriendFolderBrowser: React.FC<FriendFolderBrowserProps> = ({
  friendUserId,
  friendUsername,
  onBack,
  submitLabel,
  onSubmit,
  submitting = false,
  helperText,
}) => {
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<VisibleFolder[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'collections'>('cards');
  const [selectedEra, setSelectedEra] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [visibleFolders, setsList] = await Promise.all([
        getFriendVisibleFolders(friendUserId),
        fetchSets(),
      ]);
      setFolders(visibleFolders);
      setSets(setsList || []);

      const allCardIds = Array.from(new Set(visibleFolders.flatMap((f) => f.cards.map((c) => c.cardId))));
      const setIds = Array.from(new Set(allCardIds.map((id) => id.split('-')[0])));
      const cardsMap: Record<string, Card> = {};
      await Promise.all(
        setIds.map(async (setId) => {
          try {
            const cards = await fetchCardsBySet(setId);
            for (const card of cards) {
              cardsMap[card.id] = card;
            }
          } catch {
            // Ignora sets que falharem ao carregar; as cartas aparecem sem metadados visuais
          }
        })
      );
      setCardsById(cardsMap);
      setLoading(false);
    };
    load();
  }, [friendUserId]);

  const selectedFolder = folders.find((f) => f.id === selectedFolderId) || null;

  // O card retornado pela API não inclui a série/era diretamente, então a era
  // precisa ser resolvida procurando o set completo na lista de sets carregada.
  const getCardEra = (card: Card | null): string | undefined => {
    if (!card) return undefined;
    return sets.find((s) => s.id === card.set.id)?.series;
  };

  const eras = useMemo(() => Array.from(new Set(sets.map((s) => s.series))), [sets]);

  const lines: ResolvedLine[] = useMemo(() => {
    if (!selectedFolder) return [];
    const result: ResolvedLine[] = [];
    for (const card of selectedFolder.cards) {
      for (const item of card.items) {
        result.push({
          cardId: card.cardId,
          card: cardsById[card.cardId] || null,
          variation: item.variation,
          condition: item.condition,
          availableQuantity: item.quantity,
          price: item.price,
        });
      }
    }
    return result;
  }, [selectedFolder, cardsById]);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    const q = searchQuery.toLowerCase().trim();
    return lines.filter((line) => {
      if (!line.card) return line.cardId.toLowerCase().includes(q);
      const fullNum = getCompleteCardNumber(line.card).toLowerCase();
      return (
        line.card.name.toLowerCase().includes(q) ||
        line.card.number.toLowerCase().includes(q) ||
        fullNum.includes(q) ||
        line.card.set.name.toLowerCase().includes(q)
      );
    });
  }, [lines, searchQuery]);

  // Reseta a página sempre que a lista filtrada ou a navegação de coleção mudam
  useEffect(() => {
    setPage(1);
  }, [filteredLines, selectedSetId]);

  const setLineQuantity = (line: ResolvedLine, quantity: number) => {
    const key = selectionKey(line.cardId, line.variation, line.condition);
    const clamped = Math.max(0, Math.min(quantity, line.availableQuantity));
    setSelectedQuantities((prev) => {
      const next = { ...prev };
      if (clamped === 0) delete next[key];
      else next[key] = clamped;
      return next;
    });
  };

  const selectedLines = lines
    .map((line) => ({ line, quantity: selectedQuantities[selectionKey(line.cardId, line.variation, line.condition)] || 0 }))
    .filter((entry) => entry.quantity > 0);

  const totalValue = selectedLines.reduce((sum, { line, quantity }) => sum + quantity * line.price, 0);
  const totalCards = selectedLines.reduce((sum, { quantity }) => sum + quantity, 0);

  const handleSubmit = () => {
    if (!selectedFolder) return;
    const items: TradeItemSelection[] = selectedLines.map(({ line, quantity }) => ({
      cardId: line.cardId,
      variation: line.variation,
      condition: line.condition,
      quantity,
    }));
    onSubmit(selectedFolder.id, items, totalValue);
  };

  const openFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setSearchQuery('');
    setViewMode('cards');
    setSelectedEra(null);
    setSelectedSetId(null);
    setPage(1);
  };

  const renderLine = (line: ResolvedLine) => {
    const key = selectionKey(line.cardId, line.variation, line.condition);
    const qty = selectedQuantities[key] || 0;
    const isSelected = qty > 0;
    return (
      <div
        key={key}
        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isSelected ? 'border-[#646B99]/40 bg-[#646B99]/5' : 'border-slate-100 bg-white'}`}
      >
        {line.card && (
          <img src={line.card.imageUrl} className="w-12 h-16 rounded-lg object-contain bg-slate-50 border border-slate-100/40 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold text-slate-800 truncate">
            {line.card ? line.card.name : line.cardId}
          </h4>
          <p className="text-[9px] text-slate-400">
            {line.card ? `#${getCompleteCardNumber(line.card)} · ` : ''}{line.variation} · {line.condition}
          </p>
          <p className="text-[9px] text-slate-400">
            Disponível: {line.availableQuantity} · R${line.price.toFixed(2)}/un
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full overflow-hidden h-8">
            <button
              onClick={() => setLineQuantity(line, qty - 1)}
              disabled={qty === 0}
              className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors disabled:opacity-30"
            >
              -
            </button>
            <span className="w-6 text-center text-[11px] text-[#646B99] tabular-nums">{qty}</span>
            <button
              onClick={() => setLineQuantity(line, qty + 1)}
              disabled={qty >= line.availableQuantity}
              className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors disabled:opacity-30"
            >
              +
            </button>
          </div>
          {isSelected && (
            <span className="text-xs font-bold text-[#646B99]">R${(qty * line.price).toFixed(2)}</span>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <div className="w-6 h-6 border-2 border-[#646B99] border-t-transparent rounded-full animate-spin" />
        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Carregando pastas...</p>
      </div>
    );
  }

  // --- Lista de pastas visíveis ---
  if (!selectedFolder) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <button onClick={onBack} className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Voltar
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-semibold text-slate-700">Pastas de {friendUsername}</span>
        </div>

        {helperText && <p className="text-[10px] text-slate-400">{helperText}</p>}

        {folders.length === 0 ? (
          <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
            <p className="text-slate-400 text-sm">{friendUsername} não tem nenhuma pasta visível no momento.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => openFolder(folder.id)}
                className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:border-[#646B99]/30 transition-all group text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500 flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#646B99] transition-colors">{folder.name}</h3>
                </div>
                <span className="text-xs bg-slate-50 border border-slate-100 text-slate-500 px-2.5 py-1 rounded-full font-medium">
                  {folder.cards.length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Cartas dentro da pasta selecionada ---
  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-24">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <button onClick={() => setSelectedFolderId(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Pastas
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-xs font-semibold text-slate-700 truncate max-w-[180px]">{selectedFolder.name}</span>
      </div>

      {helperText && <p className="text-[10px] text-slate-400">{helperText}</p>}

      {lines.length === 0 ? (
        <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
          <p className="text-slate-400 text-sm">Nenhuma carta disponível nesta pasta.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="relative">
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
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button
                onClick={() => { setViewMode('cards'); setSelectedEra(null); setSelectedSetId(null); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${viewMode === 'cards' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Todas as Cartas
              </button>
              <button
                onClick={() => { setViewMode('collections'); setSelectedEra(null); setSelectedSetId(null); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${viewMode === 'collections' ? 'bg-white text-[#646B99] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Coleções
              </button>
            </div>
          </div>

          {viewMode === 'cards' ? (
            filteredLines.length === 0 ? (
              <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                <p className="text-slate-400 text-sm">Nenhuma carta encontrada.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(renderLine)}
                <Pagination page={page} totalPages={Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE))} onPageChange={setPage} />
              </div>
            )
          ) : selectedSetId !== null ? (
            (() => {
              const setLines = filteredLines.filter((line) => line.card?.set.id === selectedSetId);
              return (
                <div className="grid gap-3">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      onClick={() => setSelectedSetId(null)}
                      className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                      Voltar para Coleções
                    </button>
                    <span className="text-slate-300">/</span>
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">
                      {sets.find((s) => s.id === selectedSetId)?.name}
                    </span>
                  </div>
                  {setLines.length === 0 ? (
                    <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                      <p className="text-slate-400 text-sm">Nenhuma carta encontrada.</p>
                    </div>
                  ) : (
                    <>
                      {setLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(renderLine)}
                      <Pagination page={page} totalPages={Math.max(1, Math.ceil(setLines.length / PAGE_SIZE))} onPageChange={setPage} />
                    </>
                  )}
                </div>
              );
            })()
          ) : selectedEra !== null ? (
            <div className="space-y-3">
              <button
                onClick={() => setSelectedEra(null)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                Voltar para Eras
              </button>
              <div className="grid grid-cols-2 gap-3">
                {sets
                  .filter((s) => s.series === selectedEra)
                  .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
                  .map((set) => {
                    const count = new Set(filteredLines.filter((line) => line.card?.set.id === set.id).map((l) => l.cardId)).size;
                    if (count === 0) return null;
                    return (
                      <button
                        key={set.id}
                        onClick={() => setSelectedSetId(set.id)}
                        className="flex flex-col items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#646B99]/30 transition-all group min-h-[110px]"
                      >
                        <div className="h-10 w-full flex items-center justify-center mb-1">
                          <img src={set.logoUrl} className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform" />
                        </div>
                        <p className="text-[10px] font-medium text-slate-600 line-clamp-1 text-center">{set.name}</p>
                        <p className="text-[9px] font-semibold text-[#646B99] bg-[#646B99]/5 px-2 py-0.5 rounded-full mt-1">
                          {count} {count === 1 ? 'carta' : 'cartas'}
                        </p>
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {eras.map((era) => {
                const count = new Set(filteredLines.filter((line) => getCardEra(line.card) === era).map((l) => l.cardId)).size;
                if (count === 0) return null;
                return (
                  <button
                    key={era}
                    onClick={() => setSelectedEra(era)}
                    className="w-full flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#646B99]/30 transition-all"
                  >
                    <span className="text-xs font-semibold text-slate-700">{era}</span>
                    <span className="text-[10px] font-semibold text-[#646B99] bg-[#646B99]/5 px-2.5 py-1 rounded-full border border-[#646B99]/10">
                      {count} {count === 1 ? 'carta' : 'cartas'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {totalCards > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center px-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest">{totalCards} carta(s) selecionada(s)</p>
              <p className="text-lg font-bold text-[#646B99]">R${totalValue.toFixed(2)}</p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2.5 bg-[#646B99] text-white text-xs font-semibold rounded-xl hover:bg-[#4d5275] transition-colors disabled:opacity-50"
            >
              {submitting ? 'Enviando...' : submitLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FriendFolderBrowser;
