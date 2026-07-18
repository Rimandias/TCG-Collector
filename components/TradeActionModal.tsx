import React, { useState } from 'react';
import { Trade, TradeItem } from '../types';
import { patchTrade, submitTradeOffer, TradeItemSelection } from '../trades';
import FriendFolderBrowser from './FriendFolderBrowser';

interface TradeActionModalProps {
  trade: Trade;
  myUserId: string;
  onClose: () => void;
  onChanged: (trade: Trade) => void;
}

const describeItems = (items: TradeItem[]) => {
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  return { count: items.reduce((sum, i) => sum + i.quantity, 0), total };
};

const TradeActionModal: React.FC<TradeActionModalProps> = ({ trade, myUserId, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const isInitiator = trade.initiatorId === myUserId;
  const isRecipient = trade.recipientId === myUserId;
  const counterpartName = isInitiator ? trade.recipientUsername : trade.initiatorUsername;
  const myConfirmed = isInitiator ? trade.initiatorConfirmed : trade.recipientConfirmed;

  const requested = describeItems(trade.requestedItems);
  const offered = describeItems(trade.offeredItems);
  const diff = requested.total - offered.total;

  const runAction = async (action: 'choose_payment' | 'choose_offer' | 'confirm' | 'cancel') => {
    setBusy(true);
    setError(null);
    const { trade: updated, error: err } = await patchTrade(trade.id, action);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (updated) onChanged(updated);
  };

  const handleSubmitOffer = async (_folderId: string, items: TradeItemSelection[]) => {
    setBusy(true);
    setError(null);
    const { trade: updated, error: err } = await submitTradeOffer(trade.id, items);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (updated) onChanged(updated);
  };

  const wrapperClass = 'fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200';
  const cardClass = 'bg-white border border-slate-100 w-full max-w-sm rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto';

  // --- Recipient escolhendo cartas do amigo (Ash) em troca ---
  if (trade.status === 'selecting_offer' && isRecipient) {
    return (
      <div className={wrapperClass}>
        <div className="bg-white border border-slate-100 w-full max-w-lg rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Escolher cartas para troca do amigo</h3>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-500">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <FriendFolderBrowser
            friendUserId={trade.initiatorId}
            friendUsername={trade.initiatorUsername}
            onBack={onClose}
            submitLabel="Confirmar cartas escolhidas"
            submitting={busy}
            helperText={`Escolha as cartas de ${trade.initiatorUsername} que você quer receber em troca das suas ${requested.count} carta(s).`}
            onSubmit={handleSubmitOffer}
          />
        </div>
      </div>
    );
  }

  // --- Popup de cancelamento (segunda confirmação) ---
  if (confirmingCancel) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Cancelar acordo?</h3>
          <p className="text-[10px] text-slate-400 mb-4">Todos os acordos dessa troca serão cancelados e nada será movido entre as contas.</p>
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmingCancel(false)}
              disabled={busy}
              className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
            >
              Voltar
            </button>
            <button
              onClick={() => runAction('cancel')}
              disabled={busy}
              className="flex-1 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {busy ? 'Cancelando...' : 'OK, cancelar'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- pending_response: recipient decide o que fazer ---
  if (trade.status === 'pending_response' && isRecipient) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Há uma troca disponível!</h3>
          <p className="text-[10px] text-slate-400 mb-4">
            <span className="font-semibold text-slate-600">{trade.initiatorUsername}</span> quer {requested.count} carta(s) sua(s), no valor de ${requested.total.toFixed(2)}.
          </p>
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <div className="space-y-2">
            <button
              onClick={() => runAction('choose_payment')}
              disabled={busy}
              className="w-full py-2.5 bg-[#646B99] text-white text-xs font-semibold rounded-xl hover:bg-[#4d5275] transition-colors disabled:opacity-50"
            >
              Pagar o valor (${requested.total.toFixed(2)})
            </button>
            <button
              onClick={() => runAction('choose_offer')}
              disabled={busy}
              className="w-full py-2.5 bg-white border border-[#646B99]/30 text-[#646B99] text-xs font-semibold rounded-xl hover:bg-[#646B99]/5 transition-colors disabled:opacity-50"
            >
              Escolher cartas para troca do amigo
            </button>
            <button
              onClick={() => runAction('cancel')}
              disabled={busy}
              className="w-full py-2 text-slate-400 text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors"
            >
              Recusar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- awaiting_payment_confirmation ---
  if (trade.status === 'awaiting_payment_confirmation') {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            {myConfirmed ? 'Aguardando confirmação' : 'Confirmar pagamento'}
          </h3>
          <p className="text-[10px] text-slate-400 mb-4">
            {isInitiator
              ? `Você paga $${requested.total.toFixed(2)} para ${counterpartName} e recebe ${requested.count} carta(s).`
              : `Você recebe $${requested.total.toFixed(2)} de ${counterpartName} e entrega ${requested.count} carta(s).`}
          </p>
          {myConfirmed ? (
            <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
              Aguardando {counterpartName} confirmar também. Assim que ambos confirmarem, as cartas são trocadas automaticamente.
            </p>
          ) : null}
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmingCancel(true)}
              disabled={busy}
              className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            {!myConfirmed && (
              <button
                onClick={() => runAction('confirm')}
                disabled={busy}
                className="flex-1 py-2 bg-[#646B99] text-white text-xs font-semibold rounded-lg hover:bg-[#4d5275] transition-colors disabled:opacity-50"
              >
                {busy ? 'Confirmando...' : 'OK, confirmar'}
              </button>
            )}
          </div>
          {myConfirmed && (
            <button onClick={onClose} className="w-full mt-2 py-2 text-slate-400 text-[10px] uppercase tracking-widest hover:text-slate-600">
              Fechar
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- awaiting_value_diff_confirmation ---
  if (trade.status === 'awaiting_value_diff_confirmation') {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">
            {myConfirmed ? 'Aguardando confirmação' : 'Diferença de valor pendente'}
          </h3>
          <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-100 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Cartas de {trade.recipientUsername}</span>
              <span className="font-semibold text-slate-700">${requested.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Cartas de {trade.initiatorUsername}</span>
              <span className="font-semibold text-slate-700">${offered.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs pt-2 border-t border-slate-200">
              <span className="text-slate-600 font-semibold">Diferença</span>
              <span className={`font-bold ${diff === 0 ? 'text-emerald-500' : 'text-amber-600'}`}>${Math.abs(diff).toFixed(2)}</span>
            </div>
          </div>
          {myConfirmed ? (
            <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-3 mb-4">
              Aguardando {counterpartName} confirmar também.
            </p>
          ) : null}
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmingCancel(true)}
              disabled={busy}
              className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            {!myConfirmed && (
              <button
                onClick={() => runAction('confirm')}
                disabled={busy}
                className="flex-1 py-2 bg-[#646B99] text-white text-xs font-semibold rounded-lg hover:bg-[#4d5275] transition-colors disabled:opacity-50"
              >
                {busy ? 'Confirmando...' : 'OK'}
              </button>
            )}
          </div>
          {myConfirmed && (
            <button onClick={onClose} className="w-full mt-2 py-2 text-slate-400 text-[10px] uppercase tracking-widest hover:text-slate-600">
              Fechar
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- pending_response, mas eu sou o iniciador: só aguardando ---
  if (trade.status === 'pending_response' && isInitiator) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Aguardando resposta</h3>
          <p className="text-[10px] text-slate-400 mb-4">
            Seu pedido de {requested.count} carta(s) (${requested.total.toFixed(2)}) para {counterpartName} ainda não foi respondido.
          </p>
          {error && <p className="text-red-500 text-[10px] mb-3">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors">
              Fechar
            </button>
            <button
              onClick={() => runAction('cancel')}
              disabled={busy}
              className="flex-1 py-2 bg-red-50 text-red-500 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              Cancelar pedido
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- selecting_offer, mas eu sou o iniciador: aguardando o amigo escolher ---
  if (trade.status === 'selecting_offer' && isInitiator) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Aguardando escolha</h3>
          <p className="text-[10px] text-slate-400 mb-4">
            {counterpartName} está escolhendo quais das suas cartas quer receber em troca.
          </p>
          <button onClick={onClose} className="w-full py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default TradeActionModal;
