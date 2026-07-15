
import React, { useState } from 'react';
import { User } from '../types';

interface SettingsViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
  onLogout: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ user, onUpdateUser, onLogout }) => {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(user.username);
  const [newPassword, setNewPassword] = useState('');
  const [showPwdMsg, setShowPwdMsg] = useState(false);

  const handleChangeAvatar = () => {
    const newAvatar = `https://picsum.photos/seed/${Math.random()}/200`;
    onUpdateUser({ ...user, avatarUrl: newAvatar });
  };

  const handleSaveName = () => {
    onUpdateUser({ ...user, username: newName });
    setEditingName(false);
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword) {
      setShowPwdMsg(true);
      setNewPassword('');
      setTimeout(() => setShowPwdMsg(false), 3000);
    }
  };

  const removeFriend = (friendName: string) => {
    onUpdateUser({ ...user, friends: user.friends.filter(f => f !== friendName) });
  };

  return (
    <div className="animate-in fade-in duration-500 px-6">
      <div className="mb-8">
        <h2 className="text-2xl text-slate-800 mb-2">Configurações</h2>
        <p className="text-slate-400 text-xs uppercase tracking-widest">Gerencie seu perfil e conexões.</p>
      </div>

      <div className="space-y-8 pb-10">
        <section className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
          <div className="flex items-center gap-6 mb-8">
             <div className="relative group">
               <img src={user.avatarUrl} alt="User Avatar" className="w-20 h-20 rounded-2xl object-cover border-4 border-white shadow-sm" />
               <button 
                 onClick={handleChangeAvatar}
                 className="absolute bottom-0 right-0 p-2 bg-[#646B99] text-white rounded-lg shadow-md hover:scale-105 transition-transform"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
               </button>
             </div>
             <div className="flex-1">
               {editingName ? (
                 <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newName} 
                      onChange={(e) => setNewName(e.target.value)} 
                      className="bg-white border border-slate-100 rounded-lg px-3 py-1.5 text-slate-700 w-full outline-none focus:ring-1 focus:ring-[#646B99]"
                    />
                    <button onClick={handleSaveName} className="p-1.5 bg-emerald-500 text-white rounded-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                 </div>
               ) : (
                 <div className="flex items-center gap-2">
                    <h3 className="text-lg text-slate-800">{user.username}</h3>
                    <button onClick={() => setEditingName(true)} className="text-slate-300 hover:text-[#646B99] transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    </button>
                 </div>
               )}
               <p className="text-xs text-slate-400">{user.email}</p>
             </div>
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <h4 className="text-[10px] text-slate-300 uppercase tracking-widest">Alterar Senha</h4>
            <div className="flex gap-3">
              <input 
                type="password" 
                placeholder="Nova senha..." 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1 bg-white border border-slate-100 rounded-xl px-4 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-[#646B99] outline-none"
              />
              <button 
                type="submit"
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-slate-600 text-sm transition-colors"
              >
                Atualizar
              </button>
            </div>
            {showPwdMsg && (
              <p className="text-emerald-500 text-[10px] uppercase tracking-widest">Senha atualizada com sucesso!</p>
            )}
          </form>
        </section>

        <section className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
           <h4 className="text-[10px] text-slate-300 uppercase tracking-widest mb-4">Gerenciar Amigos ({user.friends.length})</h4>
           <div className="space-y-2">
             {user.friends.length === 0 ? (
               <p className="text-slate-400 italic text-xs">Nenhum amigo adicionado.</p>
             ) : (
               user.friends.map(friend => (
                 <div key={friend} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                    <span className="text-slate-700 text-sm">{friend}</span>
                    <button 
                      onClick={() => removeFriend(friend)}
                      className="text-red-400 hover:text-red-500 text-[10px] uppercase tracking-widest px-2 py-1"
                    >
                      Remover
                    </button>
                 </div>
               ))
             )}
           </div>
        </section>

        <button 
          onClick={onLogout}
          className="w-full py-4 bg-white text-red-400 rounded-2xl border border-red-50 shadow-sm hover:bg-red-50 transition-all uppercase tracking-[0.2em] text-[10px]"
        >
          Sair da Conta
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
