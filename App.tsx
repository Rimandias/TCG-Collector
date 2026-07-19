
import React, { useState, useEffect, useRef } from 'react';
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
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setUser(null);
    await clearSession();
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUser(updatedUser);

    // Agrupa atualizações rápidas (ex: cliques repetidos de +/-) em uma única gravação no servidor
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistUser(updatedUser);
    }, 500);
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
            searchQuery={searchQuery}
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
            searchQuery={searchQuery}
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
                  setActiveTab(AppTab.HOME);
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
                setActiveTab(AppTab.HOME);
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

      <main className="flex-1 overflow-y-auto pb-16">
        {renderContent()}
      </main>

      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
};

export default App;
