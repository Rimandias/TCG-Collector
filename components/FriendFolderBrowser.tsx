import React, { useEffect, useMemo, useState } from 'react';
import { Card, VisibleFolder } from '../types';
import { getCompleteCardNumber } from '../db';
import { fetchCardsBySet } from '../api';
import { getFriendVisibleFolders, TradeItemSelection } from '../trades';

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
  quantity: number;
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
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const visibleFolders = await getFriendVisibleFolders(friendUserId);
      setFolders(visibleFolders);

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
          quantity: item.quantity,
          price: item.price,
        });
      }
    }
    return result;
  }, [selectedFolder, cardsById]);

  const toggleLine = (line: ResolvedLine) => {
    const key = selectionKey(line.cardId, line.variation, line.condition);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedLines = lines.filter((line) => selectedKeys.has(selectionKey(line.cardId, line.variation, line.condition)));
  const totalValue = selectedLines.reduce((sum, line) => sum + line.quantity * line.price, 0);

  const handleSubmit = () => {
    if (!selectedFolder) return;
    const items: TradeItemSelection[] = selectedLines.map((line) => ({
      cardId: line.cardId,
      variation: line.variation,
      condition: line.condition,
    }));
    onSubmit(selectedFolder.id, items, totalValue);
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
                onClick={() => setSelectedFolderId(folder.id)}
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

      {lines.length === 0 ? (
        <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
          <p className="text-slate-400 text-sm">Nenhuma carta disponível nesta pasta.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {lines.map((line) => {
            const key = selectionKey(line.cardId, line.variation, line.condition);
            const isSelected = selectedKeys.has(key);
            return (
              <div
                key={key}
                onClick={() => toggleLine(line)}
                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-[#646B99]/40 bg-[#646B99]/5' : 'border-slate-100 bg-white hover:bg-slate-50'}`}
              >
                <input type="checkbox" checked={isSelected} onChange={() => {}} className="w-4 h-4 text-[#646B99] border-slate-300 rounded flex-shrink-0" />
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
                  <p className="text-[9px] text-slate-400">Qtd: {line.quantity}</p>
                </div>
                <span className="text-xs font-bold text-[#646B99] flex-shrink-0">
                  ${(line.quantity * line.price).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {selectedKeys.size > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 flex justify-center px-4">
          <div className="w-full max-w-lg bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest">{selectedKeys.size} carta(s) selecionada(s)</p>
              <p className="text-lg font-bold text-[#646B99]">${totalValue.toFixed(2)}</p>
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
