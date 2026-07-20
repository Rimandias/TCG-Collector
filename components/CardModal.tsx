import React, { useEffect, useMemo, useState } from 'react';
import { Card, User, CardCondition, VARIATION_TYPES } from '../types';
import { updateCardStatus, getCardTotalQuantity, getNormalizedVariations, getCompleteCardNumber, getCardEstimatedValue } from '../db';
import { fetchCardStats, CardPriceStats } from '../api';

interface CardModalProps {
  card: Card;
  user: User;
  onUpdateUser: (user: User) => void;
  onClose: () => void;
  showWarnings?: boolean;
}

const CardModal: React.FC<CardModalProps> = ({ card, user, onUpdateUser, onClose, showWarnings = false }) => {
  const [activeTab, setActiveTab] = useState<'variations' | 'price'>('variations');
  const [expandedVariation, setExpandedVariation] = useState<string | null>('Standard');
  const [priceStats, setPriceStats] = useState<CardPriceStats>({});
  const [showFullscreen, setShowFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCardStats(card.id).then((stats) => {
      if (!cancelled) setPriceStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [card.id]);

  const communityAverage = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const conditions of Object.values(priceStats)) {
      for (const stat of Object.values(conditions)) {
        sum += stat.avg * stat.count;
        count += stat.count;
      }
    }
    return count > 0 ? { avg: sum / count, count } : null;
  }, [priceStats]);

  const cardData = user.ownedCards[card.id] || {
    isOwned: false,
    isForTrade: false,
    variations: {}
  };

  const normalizedVariations = getNormalizedVariations(cardData.variations);

  const updateVariationValue = (variation: string, condition: CardCondition, updates: { quantity?: number; price?: string }) => {
    const updated = { ...normalizedVariations };
    
    if (updates.quantity !== undefined) {
      updated[variation][condition].quantity = Math.max(0, updates.quantity);
    }
    if (updates.price !== undefined) {
      updated[variation][condition].price = updates.price;
    }
    
    // Auto-owned is updated in updateCardStatus helper
    onUpdateUser(updateCardStatus(user, card.id, { variations: updated }));
  };

  const totalQty = getCardTotalQuantity(cardData.variations);
  const estimatedValue = getCardEstimatedValue(cardData.variations);
  const averageUnitPrice = totalQty > 0 ? estimatedValue / totalQty : 0;

  const getVariationSubtotal = (variationData: Record<CardCondition, { quantity: number; price: string }>) => {
    return Object.values(variationData).reduce((sum, cond) => sum + (cond.quantity || 0), 0);
  };

  const toggleExpand = (varName: string) => {
    setExpandedVariation(prev => prev === varName ? null : varName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      {showFullscreen && (
        <div
          onClick={() => setShowFullscreen(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/95 animate-in fade-in duration-200"
        >
          <button
            onClick={() => setShowFullscreen(false)}
            className="absolute top-5 right-5 p-2 bg-white/10 rounded-full hover:bg-white/20 text-white transition-colors z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
          <img
            src={card.imageUrlHiRes || card.imageUrl}
            alt={card.name}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <div className="bg-white border border-slate-100 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header & Card Details */}
        <div className="relative p-5 pb-3 flex flex-col items-center flex-shrink-0">
          <button 
            onClick={onClose}
            className="absolute top-5 right-5 p-2 bg-slate-50 rounded-full hover:bg-slate-100 text-slate-400 transition-colors z-10"
          >
             <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
          
          <div
            onClick={onClose}
            className="relative w-32 aspect-[2/2.8] rounded-2xl overflow-hidden shadow-2xl mb-3 cursor-pointer"
          >
            <img
              src={card.imageUrlHiRes || card.imageUrl}
              alt={card.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <button
              onClick={(e) => { e.stopPropagation(); setShowFullscreen(true); }}
              className="absolute bottom-1.5 right-1.5 p-1.5 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors"
              title="Ver em tela cheia"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
            </button>
          </div>
          
          <h2 className="text-base font-bold text-slate-800 mb-0.5 text-center uppercase tracking-tight">{card.name}</h2>
          <p className="text-slate-400 text-[9px] uppercase tracking-widest mb-1.5">{card.rarity} • #{getCompleteCardNumber(card)}</p>
          <div className="text-sm font-semibold text-[#646B99] bg-slate-50 border border-slate-100 px-3 py-1 rounded-full text-center">
            Total: {totalQty} cartas
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-t border-slate-50 flex-shrink-0">
          <button 
            onClick={() => setActiveTab('variations')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest transition-colors font-semibold ${activeTab === 'variations' ? 'text-[#646B99] border-b-2 border-[#646B99]' : 'text-slate-300 hover:text-slate-400'}`}
          >
            Variações
          </button>
          <button 
            onClick={() => setActiveTab('price')}
            className={`flex-1 py-3 text-[10px] uppercase tracking-widest transition-colors font-semibold ${activeTab === 'price' ? 'text-[#646B99] border-b-2 border-[#646B99]' : 'text-slate-300 hover:text-slate-400'}`}
          >
            Preço Médio
          </button>
        </div>

        {/* Active Tab Content */}
        <div className="px-4 pb-4 pt-2 flex-1 overflow-y-auto min-h-0">
          {activeTab === 'variations' ? (
            <div className="space-y-3">
              {VARIATION_TYPES.map(variation => {
                const variationData = normalizedVariations[variation];
                const subtotal = getVariationSubtotal(variationData);
                const isExpanded = expandedVariation === variation;

                return (
                  <div key={variation} className="bg-slate-50 rounded-2xl border border-slate-100/50 overflow-hidden transition-all duration-200">
                    {/* Variation Header */}
                    <button 
                      onClick={() => toggleExpand(variation)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-100/40 hover:bg-slate-100/80 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">{variation}</span>
                        {subtotal > 0 && (
                          <span className="px-2 py-0.5 bg-[#646B99] text-white text-[9px] rounded-full font-bold">
                            {subtotal}
                          </span>
                        )}
                        {subtotal === 1 && showWarnings && (
                          <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-600 text-[8px] font-bold rounded uppercase tracking-wider">
                            Única!
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold">
                          {isExpanded ? 'Ocultar' : 'Expandir'}
                        </span>
                        <svg 
                          xmlns="http://www.w3.org/2000/svg" 
                          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6"/>
                        </svg>
                      </div>
                    </button>

                    {/* Expanded Conditions and Custom Prices */}
                    {isExpanded && (
                      <div className="p-3.5 space-y-3 bg-white border-t border-slate-100/50 animate-in slide-in-from-top-1 duration-200">
                        {(Object.keys(variationData) as CardCondition[]).map(cond => {
                          const details = variationData[cond];
                          return (
                            <div key={cond} className="flex items-center justify-between bg-slate-50/50 p-2.5 rounded-xl border border-slate-100/30 gap-2">
                              {/* Left: Quality tag */}
                              <div className="flex flex-col min-w-[50px] flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-700 leading-none">{cond}</span>
                                  {details.quantity === 1 && showWarnings && (
                                    <span className="px-1 py-0.5 bg-amber-50 border border-amber-200 text-amber-600 text-[7px] font-bold rounded uppercase tracking-wider">
                                      Única!
                                    </span>
                                  )}
                                </div>
                                <span className="text-[8px] text-slate-400 uppercase tracking-tight mt-0.5">
                                  {cond === 'NM' && 'Near Mint'}
                                  {cond === 'SP' && 'Slight Played'}
                                  {cond === 'MP' && 'Mod Played'}
                                  {cond === 'HP' && 'Heav Played'}
                                  {cond === 'D' && 'Damaged'}
                                </span>
                              </div>

                              {/* Middle: Stepper Counter */}
                              <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden h-7 shadow-sm">
                                <button 
                                  onClick={() => updateVariationValue(variation, cond, { quantity: details.quantity - 1 })}
                                  className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-slate-50 transition-colors font-bold text-sm"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center text-[11px] text-[#646B99] font-semibold tabular-nums">
                                  {details.quantity}
                                </span>
                                <button 
                                  onClick={() => updateVariationValue(variation, cond, { quantity: details.quantity + 1 })}
                                  className="w-7 h-full flex items-center justify-center text-slate-400 hover:text-emerald-500 hover:bg-slate-50 transition-colors font-bold text-sm"
                                >
                                  +
                                </button>
                              </div>

                              {/* Right: Custom Price Input */}
                              <div className="relative flex items-center w-24">
                                <span className="absolute left-2 text-[10px] text-slate-400 font-semibold">R$</span>
                                <input
                                  type="text"
                                  placeholder="Preço"
                                  value={details.price || ''}
                                  onChange={(e) => updateVariationValue(variation, cond, { price: e.target.value })}
                                  className="w-full bg-white border border-slate-200 rounded-lg pl-5 pr-2 py-1 text-[11px] text-[#646B99] font-medium outline-none focus:ring-1 focus:ring-[#646B99] transition-all text-right h-7"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4 p-2 text-center">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <p className="text-slate-400 text-[10px] mb-1.5 uppercase tracking-[0.2em] font-bold">Valor Total (sua coleção)</p>
                <div className="text-3xl font-extrabold text-emerald-500">
                    {estimatedValue > 0 ? `R$${estimatedValue.toFixed(2)}` : 'N/A'}
                </div>
                <p className="text-[9px] text-slate-300 mt-3 uppercase tracking-wider">
                  {totalQty > 0 ? `Preço médio: R$${averageUnitPrice.toFixed(2)} por unidade` : 'Baseado nos preços que você informou'}
                </p>
              </div>

              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-left">
                <p className="text-slate-400 text-[10px] mb-1.5 uppercase tracking-[0.2em] font-bold text-center">Preço da Comunidade</p>
                {communityAverage ? (
                  <>
                    <div className="text-3xl font-extrabold text-[#646B99] text-center">
                      R${communityAverage.avg.toFixed(2)}
                    </div>
                    <p className="text-[9px] text-slate-300 mt-1 mb-4 uppercase tracking-wider text-center">
                      Média de {communityAverage.count} preço(s) informado(s) por usuários
                    </p>
                    <div className="space-y-1.5">
                      {Object.entries(priceStats).map(([variation, conditions]) =>
                        Object.entries(conditions).map(([condition, stat]) => (
                          <div key={`${variation}-${condition}`} className="flex items-center justify-between text-[10px] text-slate-400 bg-white border border-slate-100 rounded-lg px-3 py-1.5">
                            <span className="font-medium text-slate-500">{variation} {condition}</span>
                            <span>R${stat.min.toFixed(2)} – R${stat.max.toFixed(2)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-slate-400 text-xs text-center py-2">Nenhum preço informado por usuários ainda.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CardModal;
