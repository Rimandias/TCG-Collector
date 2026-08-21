import React, { useEffect, useMemo, useState } from 'react';
import { Card, PokemonSet, CardCondition, VARIATION_TYPES } from '../types';
import { getCompleteCardNumber, compareCardsByCollectionThenNumber } from '../db';
import { fetchCardsBySet, fetchSets } from '../api';
import { getPublicFolder, PublicFolderData } from '../trades';
import { getAccessToken, addFriendByCode } from '../auth';
import CardViewModeSelector from '../components/CardViewModeSelector';
import { CardViewMode } from '../components/CardItem';
import VariationSlotTile, { VariationSlot } from '../components/VariationSlotTile';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import CardImage from '../components/CardImage';
import { getCardGridClassName, getInitialCardViewMode, saveCardViewMode } from '../viewMode';

interface PublicFolderViewProps {
  token: string;
}

// Página de visualização pública (sem login) de uma pasta compartilhada por link - o token na
// URL É a autorização, não há sessão nem cookie envolvidos. Só exibe as cartas dessa pasta
// específica: sem menu do app, sem edição, sem iniciar troca - a única ação possível é
// adicionar o dono como amigo, e só pra quem já tem conta (ver popup abaixo).
const PublicFolderView: React.FC<PublicFolderViewProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<PublicFolderData | null>(null);
  const [sets, setSets] = useState<PokemonSet[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [folderData, setsList] = await Promise.all([getPublicFolder(token), fetchSets()]);
      if (cancelled) return;
      if (!folderData) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setData(folderData);
      setSets(setsList || []);

      const cardIds = folderData.cards.map((c) => c.cardId);
      const setIds = Array.from(new Set(cardIds.map((id) => id.split('-')[0])));
      const map: Record<string, Card> = {};
      await Promise.all(
        setIds.map(async (setId) => {
          try {
            const cardsInSet = await fetchCardsBySet(setId);
            for (const card of cardsInSet) map[card.id] = card;
          } catch {
            // Ignora sets que falharem ao carregar - as cartas somem da lista exibida
          }
        })
      );
      if (!cancelled) setCardsById(map);
      if (!cancelled) setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const lines: VariationSlot[] = useMemo(() => {
    if (!data) return [];
    const result: VariationSlot[] = [];
    for (const card of data.cards) {
      const cardInfo = cardsById[card.cardId];
      if (!cardInfo) continue;
      for (const item of card.items) {
        result.push({ card: cardInfo, variation: item.variation, condition: item.condition, language: item.language, quantity: item.quantity, price: item.price });
      }
    }
    return result;
  }, [data, cardsById]);

  const [searchQuery, setSearchQuery] = useState('');
  const [browseMode, setBrowseMode] = useState<'cards' | 'collections'>('cards');
  const [selectedEra, setSelectedEra] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  // Grid por padrão (grid3 no mobile, grid6 no desktop - ver getInitialCardViewMode).
  const [cardsLayout, setCardsLayoutState] = useState<CardViewMode>(getInitialCardViewMode);
  const setCardsLayout = (mode: CardViewMode) => {
    setCardsLayoutState(mode);
    saveCardViewMode(mode);
  };
  const [showFilters, setShowFilters] = useState(false);
  const [filterRarity, setFilterRarity] = useState('all');
  const [filterSet, setFilterSet] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterQuality, setFilterQuality] = useState('all');
  const [page, setPage] = useState(1);

  const releaseDateBySetId = useMemo(() => {
    const map: Record<string, string> = {};
    sets.forEach((s) => { map[s.id] = s.releaseDate; });
    return map;
  }, [sets]);

  // Mais nova pra mais antiga (mesma convenção de TradesView/CollectionView) - antes vinha
  // na ordem arbitrária de `sets`, sem relação com data de lançamento.
  const eras = useMemo(() => {
    const uniqueSeries: string[] = Array.from(new Set(sets.map((s) => s.series)));
    const oldestReleaseDate = (era: string): string => {
      const eraSets = sets.filter((s) => s.series === era);
      if (eraSets.length === 0) return '9999-99-99';
      const dates = eraSets.map((s) => s.releaseDate).sort();
      return dates[0];
    };
    return uniqueSeries.sort((a, b) => {
      const dateA = oldestReleaseDate(a);
      const dateB = oldestReleaseDate(b);
      return dateB.localeCompare(dateA);
    });
  }, [sets]);
  const getCardEra = (card: Card): string | undefined => sets.find((s) => s.id === card.set.id)?.series;

  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const fullNum = getCompleteCardNumber(line.card).toLowerCase();
        const matches =
          line.card.name.toLowerCase().includes(q) ||
          line.card.number.toLowerCase().includes(q) ||
          fullNum.includes(q) ||
          line.card.set.name.toLowerCase().includes(q) ||
          (line.card.artist || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filterRarity !== 'all' && line.card.rarity !== filterRarity) return false;
      if (filterSet !== 'all' && line.card.set.id !== filterSet) return false;
      if (filterCategory !== 'all' && line.variation !== filterCategory) return false;
      if (filterQuality !== 'all' && line.condition !== filterQuality) return false;
      return true;
    }).sort((a, b) => compareCardsByCollectionThenNumber(a.card, b.card, releaseDateBySetId));
  }, [lines, searchQuery, filterRarity, filterSet, filterCategory, filterQuality, releaseDateBySetId]);

  const rarities = useMemo(() => Array.from(new Set(lines.map((l) => l.card.rarity).filter(Boolean))).sort(), [lines]);
  const setOptions = useMemo(() => {
    const unique = new Map<string, string>();
    lines.forEach((l) => unique.set(l.card.set.id, l.card.set.name));
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [lines]);
  const variationOptions = useMemo(() => {
    const present = new Set(lines.map((l) => l.variation));
    const base = VARIATION_TYPES.filter((v) => present.has(v));
    const extra = Array.from(present).filter((v) => !VARIATION_TYPES.includes(v)).sort();
    return [...base, ...extra];
  }, [lines]);

  useEffect(() => {
    setPage(1);
  }, [filteredLines, selectedSetId]);

  // --- Adicionar amigo: só funciona com sessão válida - sem uma, mostra o popup pedindo conta ---
  const [friendState, setFriendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [friendError, setFriendError] = useState<string | null>(null);
  const [showAccountPopup, setShowAccountPopup] = useState(false);

  const handleAddFriend = async () => {
    const token = await getAccessToken();
    if (!token) {
      setShowAccountPopup(true);
      return;
    }
    setFriendState('sending');
    setFriendError(null);
    const result = await addFriendByCode(data!.owner.friendCode);
    if (result.user) {
      setFriendState('sent');
    } else {
      setFriendState('error');
      setFriendError(result.error || 'Não foi possível adicionar.');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white gap-3">
        <div className="w-10 h-10 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-xs uppercase tracking-widest">Carregando pasta...</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white gap-4 px-6 text-center">
        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        </div>
        <h1 className="text-slate-800 text-sm uppercase tracking-widest">Link inválido ou expirado</h1>
        <p className="text-slate-400 text-xs">Peça um novo link para quem compartilhou esta pasta com você.</p>
      </div>
    );
  }

  const renderGridTile = (line: VariationSlot, i: number) => (
    <VariationSlotTile key={`${line.card.id}::${line.variation}::${line.condition}::${i}`} slot={line} viewMode={cardsLayout} />
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md px-4 py-3 border-b border-slate-100 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <img
            src={data.owner.avatarUrl}
            alt={data.owner.username}
            className="w-10 h-10 rounded-full bg-slate-100 object-cover border border-slate-200 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-slate-800 truncate">{data.owner.username}</h1>
            <p className="text-[10px] text-slate-400">compartilhou uma pasta com você via TCG Colecionador</p>
          </div>
          <button
            onClick={handleAddFriend}
            disabled={friendState === 'sending' || friendState === 'sent'}
            className={`px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex-shrink-0 ${
              friendState === 'sent'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-[#646B99] text-white hover:bg-[#4d5275] disabled:opacity-60'
            }`}
          >
            {friendState === 'sending' ? 'Enviando...' : friendState === 'sent' ? 'Amigo adicionado!' : '+ Adicionar Amigo'}
          </button>
        </div>
        {friendState === 'error' && friendError && (
          <p className="text-[10px] text-red-500 mt-2">{friendError}</p>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-10 pt-4 md:px-32">
        <div className="mb-4">
          <h2 className="text-2xl text-slate-800">{data.folderName}</h2>
          <p className="text-slate-400 text-xs">{filteredLines.length} {filteredLines.length === 1 ? 'slot' : 'slots'} nesta pasta.</p>
        </div>

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
            {(browseMode === 'cards' || selectedSetId !== null) && (
              <>
                <CardViewModeSelector viewMode={cardsLayout} onChange={setCardsLayout} />
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-2 border rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all flex-shrink-0 ${showFilters ? 'bg-[#646B99] text-white border-[#646B99]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  Filtros
                </button>
              </>
            )}
          </div>

          <div className="flex bg-white p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => { setBrowseMode('cards'); setSelectedEra(null); setSelectedSetId(null); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${browseMode === 'cards' ? 'bg-[#646B99] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Todas as Cartas
            </button>
            <button
              onClick={() => { setBrowseMode('collections'); setSelectedEra(null); setSelectedSetId(null); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${browseMode === 'collections' ? 'bg-[#646B99] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Coleções
            </button>
          </div>

          {(browseMode === 'cards' || selectedSetId !== null) && showFilters && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Raridade</span>
                <select value={filterRarity} onChange={(e) => setFilterRarity(e.target.value)} className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]">
                  <option value="all">Todas as Raridades</option>
                  {rarities.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              {browseMode === 'cards' && (
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Coleção</span>
                  <select value={filterSet} onChange={(e) => setFilterSet(e.target.value)} className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]">
                    <option value="all">Todas as Coleções</option>
                    {setOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Categoria</span>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]">
                  <option value="all">Todas as Categorias</option>
                  {variationOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">Qualidade</span>
                <select value={filterQuality} onChange={(e) => setFilterQuality(e.target.value)} className="bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-slate-600 outline-none focus:border-[#646B99]">
                  <option value="all">Todas as Qualidades</option>
                  {Object.keys(CardCondition).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex justify-end mt-1">
                <button
                  onClick={() => { setFilterRarity('all'); setFilterSet('all'); setFilterCategory('all'); setFilterQuality('all'); setSearchQuery(''); }}
                  className="text-[10px] font-semibold text-slate-400 hover:text-[#646B99] transition-colors"
                >
                  Limpar Filtros
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          {browseMode === 'cards' ? (
            filteredLines.length === 0 ? (
              <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                <p className="text-slate-400 text-sm">Nenhuma carta encontrada.</p>
              </div>
            ) : cardsLayout !== 'list' ? (
              <div className="space-y-3">
                <div className={getCardGridClassName(cardsLayout)}>
                  {filteredLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(renderGridTile)}
                </div>
                <Pagination page={page} totalPages={Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE))} onPageChange={setPage} />
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((line, i) => (
                  <VariationSlotTile key={`${line.card.id}::${line.variation}::${line.condition}::${i}`} slot={line} viewMode="list" />
                ))}
                <Pagination page={page} totalPages={Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE))} onPageChange={setPage} />
              </div>
            )
          ) : selectedSetId !== null ? (
            (() => {
              const setLines = filteredLines.filter((line) => line.card.set.id === selectedSetId);
              return (
                <div className="grid gap-3">
                  <button onClick={() => setSelectedSetId(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    Voltar para Coleções
                  </button>
                  {setLines.length === 0 ? (
                    <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-100">
                      <p className="text-slate-400 text-sm">Nenhuma carta encontrada.</p>
                    </div>
                  ) : cardsLayout !== 'list' ? (
                    <>
                      <div className={getCardGridClassName(cardsLayout)}>
                        {setLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(renderGridTile)}
                      </div>
                      <Pagination page={page} totalPages={Math.max(1, Math.ceil(setLines.length / PAGE_SIZE))} onPageChange={setPage} />
                    </>
                  ) : (
                    <>
                      {setLines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((line, i) => (
                        <VariationSlotTile key={`${line.card.id}::${line.variation}::${line.condition}::${i}`} slot={line} viewMode="list" />
                      ))}
                      <Pagination page={page} totalPages={Math.max(1, Math.ceil(setLines.length / PAGE_SIZE))} onPageChange={setPage} />
                    </>
                  )}
                </div>
              );
            })()
          ) : selectedEra !== null ? (
            <div className="space-y-3">
              <button onClick={() => setSelectedEra(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                Voltar para Eras
              </button>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {sets.filter((s) => s.series === selectedEra).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).map((set) => {
                  const count = new Set(filteredLines.filter((line) => line.card.set.id === set.id).map((l) => l.card.id)).size;
                  if (count === 0) return null;
                  return (
                    <button
                      key={set.id}
                      onClick={() => setSelectedSetId(set.id)}
                      className="flex flex-col items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-[#646B99]/30 transition-all group min-h-[110px]"
                    >
                      <div className="h-10 w-full flex items-center justify-center mb-1">
                        <CardImage src={set.logoUrl} alt="" className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform" fallback="empty" />
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
                const count = new Set(filteredLines.filter((line) => getCardEra(line.card) === era).map((l) => l.card.id)).size;
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
        </div>
      </main>

      {showAccountPopup && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 flex flex-col items-center gap-3 max-w-xs text-center">
            <div className="w-12 h-12 bg-[#646B99]/10 text-[#646B99] rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <p className="text-sm font-semibold text-slate-700">Crie uma conta para interagir</p>
            <p className="text-xs text-slate-400">Você pode visualizar esta pasta livremente, mas precisa de uma conta no TCG Colecionador para adicionar {data.owner.username} como amigo.</p>
            <div className="flex gap-2 w-full mt-1">
              <button
                onClick={() => setShowAccountPopup(false)}
                className="flex-1 bg-slate-50 text-slate-500 text-xs font-semibold py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Fechar
              </button>
              <button
                onClick={() => { window.location.href = '/'; }}
                className="flex-1 bg-[#646B99] text-white text-xs font-semibold py-2 rounded-xl hover:bg-[#4d5275] transition-colors"
              >
                Criar conta / Entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicFolderView;
