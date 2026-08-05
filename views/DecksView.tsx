
import React, { useState, useEffect } from 'react';
import { User, Deck } from '../types';
import CardViewModeSelector from '../components/CardViewModeSelector';
import DeckItem from '../components/DeckItem';
import { CardViewMode } from '../components/CardItem';
import { getInitialCardViewMode, saveCardViewMode, getCardGridClassName } from '../viewMode';
import { loadDecks, saveDecks } from '../decks';

interface DecksViewProps {
  user: User;
}

const DecksView: React.FC<DecksViewProps> = ({ user }) => {
  const [viewMode, setViewMode] = useState<CardViewMode>(getInitialCardViewMode);
  const [decks, setDecks] = useState<Deck[]>(() => loadDecks(user.id));
  const [newDeckName, setNewDeckName] = useState('');

  useEffect(() => {
    saveCardViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    setDecks(loadDecks(user.id));
  }, [user.id]);

  const createDeck = () => {
    const name = newDeckName.trim();
    if (!name) return;
    const deck: Deck = {
      id: crypto.randomUUID(),
      name,
      cardIds: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [deck, ...decks];
    setDecks(updated);
    saveDecks(user.id, updated);
    setNewDeckName('');
  };

  const deleteDeck = (deckId: string) => {
    const updated = decks.filter(d => d.id !== deckId);
    setDecks(updated);
    saveDecks(user.id, updated);
  };

  return (
    <div className="animate-in fade-in duration-500 px-4 pb-20 pt-4">
      <div className="mb-4 flex items-center justify-between border-b border-slate-50 pb-4">
        <h2 className="text-2xl text-slate-800 tracking-tight leading-none">Meus Decks</h2>
        <CardViewModeSelector viewMode={viewMode} onChange={setViewMode} />
      </div>

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createDeck(); }}
          placeholder="Nome do novo deck..."
          className="flex-1 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-[#646B99] focus:bg-white transition-all"
        />
        <button
          onClick={createDeck}
          disabled={!newDeckName.trim()}
          className="px-4 py-2 bg-[#646B99] text-white text-xs font-semibold uppercase tracking-widest rounded-xl hover:bg-[#575d87] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Criar
        </button>
      </div>

      {decks.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-400 text-xs uppercase tracking-widest">Nenhum deck criado ainda</p>
        </div>
      ) : (
        <div className={getCardGridClassName(viewMode)}>
          {decks.map(deck => (
            <DeckItem key={deck.id} deck={deck} viewMode={viewMode} onDelete={deleteDeck} />
          ))}
        </div>
      )}
    </div>
  );
};

export default DecksView;
