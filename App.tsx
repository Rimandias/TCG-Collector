
import React, { useState, useEffect, useRef, useDeferredValue } from 'react';
import { User, AppTab, PokemonSet } from './types';
import { fetchCurrentUser, persistUser, logout as clearSession } from './auth';
import { supabase } from './supabaseClient';
import HomeView from './views/HomeView';
import CollectionView from './views/CollectionView';
import TradesView from './views/TradesView';
import SettingsView from './views/SettingsView';
import LoginView from './views/LoginView';
import ResetPasswordView from './views/ResetPasswordView';
import BottomNav from './components/BottomNav';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.HOME);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<PokemonSet | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // O campo de busca fica preso ao valor digitado (nunca trava), mas a filtragem pesada em
  // HomeView (que roda sobre o catálogo inteiro, ~200 coleções) usa esse valor "atrasado" —
  // sem isso, cada tecla digitada refiltrava milhares de cartas de forma síncrona e travava
  // a digitação.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Alteração mais recente ainda não confirmada como salva no servidor - fica preenchido
  // desde o instante do onUpdateUser até a resposta do PUT chegar, e é a base de tudo que
  // protege contra perda de dado num refresh/fechamento de aba no meio do caminho.
  const pendingUserRef = useRef<User | null>(null);
  const isSavingRef = useRef(false);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle');
  // Só fica true durante uma navegação que precisou esperar um salvamento em andamento -
  // é o que dispara o popup bloqueante, sem incomodar o usuário nos outros 99% do tempo em
  // que o debounce/flush acontece em segundo plano sem ninguém tentando sair da tela.
  const [blockingSave, setBlockingSave] = useState(false);
  // Popup próprio (texto customizado) pedindo confirmação de saída, disparado quando o
  // usuário tenta recarregar via atalho de teclado (F5/Ctrl+R) enquanto algo ainda está
  // sendo salvo - navegadores não permitem customizar o texto do beforeunload nativo, então
  // esse é o único jeito de perguntar "quer mesmo sair?" com uma mensagem de verdade.
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  useEffect(() => {
    const restoreSession = async () => {
      const savedUser = await fetchCurrentUser();
      if (savedUser) setUser(savedUser);
      setCheckingSession(false);
    };
    restoreSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
      }
      if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    if (pendingUserRef.current || isSavingRef.current) {
      setBlockingSave(true);
      await flushPendingSave();
      setBlockingSave(false);
    }
    setUser(null);
    await clearSession();
  };

  // Salva de verdade no servidor a alteração mais recente pendente. Chamado tanto pelo timer
  // normal (500ms depois do último onUpdateUser) quanto forçadamente antes de qualquer ponto
  // em que o usuário possa sair da página (troca de aba, aba/janela perdendo foco) - assim o
  // debounce só serve pra agrupar cliques rápidos, nunca pra arriscar perder uma alteração.
  const flushPendingSave = async () => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const toSave = pendingUserRef.current;
    if (!toSave || isSavingRef.current) return;
    pendingUserRef.current = null;
    isSavingRef.current = true;
    setSaveState('saving');
    const saved = await persistUser(toSave);
    isSavingRef.current = false;
    if (saved) {
      setSaveState((current) => (pendingUserRef.current ? current : 'idle'));
    } else {
      // Falhou - mantém marcado como pendente pra tentar de novo na próxima oportunidade
      // (troca de aba, perda de foco, ou o usuário tentando sair, que aciona o aviso nativo).
      pendingUserRef.current = toSave;
      setSaveState('error');
    }
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUser(updatedUser);
    pendingUserRef.current = updatedUser;
    setSaveState('pending');

    // Agrupa atualizações rápidas (ex: cliques repetidos de +/-) em uma única gravação no servidor
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      flushPendingSave();
    }, 500);
  };

  // Protege contra perda de alteração pendente: aviso nativo do navegador ao tentar fechar/
  // recarregar a página com algo ainda não confirmado como salvo, e salvamento forçado
  // imediato ao perder o foco da aba (troca de app, minimizar, etc) - momento em que o
  // navegador/SO pode suspender a aba sem nunca disparar o beforeunload.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingUserRef.current || isSavingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && pendingUserRef.current) {
        flushPendingSave();
      }
    };
    // F5/Ctrl+R/Cmd+R disparam o reload direto do navegador sem chance de mostrar nada -
    // interceptados aqui pra abrir nosso próprio popup com texto de verdade em vez de depender
    // só do aviso genérico (e não customizável) do beforeunload nativo.
    const handleKeyDown = (e: KeyboardEvent) => {
      const isReloadShortcut = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'));
      if (isReloadShortcut && (pendingUserRef.current || isSavingRef.current)) {
        e.preventDefault();
        setShowLeaveConfirm(true);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Falha de salvamento não fica só esperando o usuário notar o aviso e tocar nele - tenta de
  // novo sozinho depois de alguns segundos, já que a causa mais comum (erro passageiro de rede
  // ou uma corrida no servidor) tende a se resolver numa nova tentativa.
  useEffect(() => {
    if (saveState !== 'error') return;
    const retryTimer = setTimeout(() => {
      flushPendingSave();
    }, 3000);
    return () => clearTimeout(retryTimer);
  }, [saveState]);

  // Troca de aba dentro do app (Home/Coleção/Trocas/Opções) é outro momento comum antes de um
  // refresh manual. Se já não há nada pendente/em andamento, troca na hora (caso comum, sem
  // atrito nenhum). Se há, ESPERA o salvamento terminar antes de trocar de aba - só nesse caso
  // aparece o popup bloqueante avisando que é preciso aguardar, exatamente para que um refresh
  // logo em seguida nunca aborte uma gravação que ainda estava em voo.
  const handleTabChange = async (tab: AppTab) => {
    if (pendingUserRef.current || isSavingRef.current) {
      setBlockingSave(true);
      await flushPendingSave();
      setBlockingSave(false);
    }
    setActiveTab(tab);
  };

  if (checkingSession) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="w-10 h-10 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (recoveryMode) {
    return <ResetPasswordView onDone={() => setRecoveryMode(false)} />;
  }

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case AppTab.HOME:
        return (
          <HomeView 
            user={user} 
            onUpdateUser={handleUpdateUser}
            selectedSeries={selectedSeries}
            setSelectedSeries={setSelectedSeries}
            selectedSet={selectedSet}
            setSelectedSet={setSelectedSet}
            searchQuery={deferredSearchQuery}
            setSearchQuery={setSearchQuery}
          />
        );
      case AppTab.COLLECTION:
        return <CollectionView user={user} />;
      case AppTab.TRADES:
        return <TradesView user={user} onUpdateUser={handleUpdateUser} />;
      case AppTab.SETTINGS:
        return <SettingsView user={user} onUpdateUser={handleUpdateUser} onLogout={handleLogout} />;
      default:
        return (
          <HomeView 
            user={user} 
            onUpdateUser={handleUpdateUser}
            selectedSeries={selectedSeries}
            setSelectedSeries={setSelectedSeries}
            selectedSet={selectedSet}
            setSelectedSet={setSelectedSet}
            searchQuery={deferredSearchQuery}
            setSearchQuery={setSearchQuery}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md px-4 py-3 flex items-center gap-3 border-b border-slate-100 shadow-sm flex-shrink-0">
        {/* Static Left Icon Container (w-10) */}
        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
          {activeTab !== AppTab.HOME || selectedSeries || selectedSet ? (
            <button 
              onClick={() => {
                if (selectedSet) {
                  setSelectedSet(null);
                  setSearchQuery('');
                } else if (selectedSeries) {
                  setSelectedSeries(null);
                  setSearchQuery('');
                } else {
                  handleTabChange(AppTab.HOME);
                }
              }}
              className="p-2 text-slate-500 hover:text-slate-800 transition-colors bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center w-9 h-9"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          ) : (
            <div className="w-6 h-6 rounded-full border-2 border-slate-800 bg-white relative flex items-center justify-center overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[10px] bg-red-500"></div>
              <div className="absolute top-[9px] left-0 right-0 h-[2px] bg-slate-800"></div>
              <div className="w-2.5 h-2.5 rounded-full border border-slate-800 bg-white z-10"></div>
            </div>
          )}
        </div>

        {/* Static Middle Search Bar Container (flex-1) */}
        <div className="flex-1 relative">
          <input 
            type="text" 
            placeholder={
              activeTab !== AppTab.HOME
                ? "Buscar carta..."
                : selectedSet 
                  ? `Buscar em ${selectedSet.name}...` 
                  : selectedSeries 
                    ? `Buscar em ${selectedSeries}...` 
                    : "Buscar carta..."
            }
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              if (activeTab !== AppTab.HOME) {
                setSelectedSet(null);
                setSelectedSeries(null);
                handleTabChange(AppTab.HOME);
              }
            }}
            className="w-full bg-slate-50 border border-slate-200/80 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-[#646B99] focus:bg-white transition-all"
          />
          <div className="absolute left-2.5 top-2.5 text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
        </div>

        {/* Static Right Avatar Container (w-10) */}
        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
          <img src={user.avatarUrl} alt="User" className="w-8 h-8 rounded-full bg-slate-100 object-cover border border-slate-200" />
        </div>
      </header>

      {/* md:px-32 dá ~128px de respiro nas laterais no desktop, sem mexer no header nem no
          menu inferior (ambos fora deste elemento) - no mobile fica sem padding extra, igual
          a antes. */}
      <main className="flex-1 overflow-y-auto pb-16 md:px-32">
        {renderContent()}
      </main>

      {blockingSave && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 flex flex-col items-center gap-3 max-w-xs text-center">
            <span className="w-8 h-8 border-4 border-[#646B99] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-slate-700">Salvando alterações...</p>
            <p className="text-xs text-slate-400">Aguarde um instante antes de continuar, para não perder o que você acabou de mudar.</p>
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-xl px-6 py-5 flex flex-col items-center gap-3 max-w-xs text-center">
            <span className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-slate-700">Suas atualizações ainda estão sendo salvas.</p>
            <p className="text-xs text-slate-400">Se sair ou atualizar a página agora, a alteração mais recente pode não ser salva. Quer mesmo sair?</p>
            <div className="flex gap-2 w-full mt-1">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 bg-[#646B99] text-white text-xs font-semibold py-2 rounded-xl hover:bg-[#575d87] transition-colors"
              >
                Continuar aguardando
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-slate-50 text-slate-500 text-xs font-semibold py-2 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                Sair mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {saveState !== 'idle' && (
        <div className="fixed bottom-16 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
          <div
            onClick={saveState === 'error' ? () => flushPendingSave() : undefined}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-semibold shadow-lg border pointer-events-auto ${
              saveState === 'error'
                ? 'bg-red-50 border-red-200 text-red-600 cursor-pointer'
                : 'bg-white border-slate-200 text-slate-500'
            }`}
          >
            {saveState !== 'error' && (
              <span className="w-2.5 h-2.5 border-2 border-[#646B99] border-t-transparent rounded-full animate-spin" />
            )}
            {saveState === 'pending' && 'Salvando alterações...'}
            {saveState === 'saving' && 'Salvando alterações...'}
            {saveState === 'error' && 'Erro ao salvar - toque para tentar de novo'}
          </div>
        </div>
      )}

      <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />
    </div>
  );
};

export default App;
