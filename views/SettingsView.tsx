
import React, { useState } from 'react';
import { User } from '../types';
import { addFriendByCode, removeFriend as removeFriendRequest, changePassword, deleteAccount } from '../auth';

interface SettingsViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
  onLogout: () => void;
}

const formatFriendCode = (code: string) => (code ? `${code.slice(0, 4)}-${code.slice(4)}` : '');

const formatAddedAt = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '';
  }
};

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
);

const SettingsView: React.FC<SettingsViewProps> = ({ user, onUpdateUser, onLogout }) => {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [changingPwd, setChangingPwd] = useState(false);
  const [showPwdMsg, setShowPwdMsg] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [addFriendError, setAddFriendError] = useState<string | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleChangeAvatar = () => {
    const newAvatar = `https://picsum.photos/seed/${Math.random()}/200`;
    onUpdateUser({ ...user, avatarUrl: newAvatar });
  };

  const handleSaveName = () => {
    onUpdateUser({ ...user, username: newName });
    setEditingName(false);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    if (newPassword.length < 8) {
      setPwdError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('A confirmação não corresponde à nova senha.');
      return;
    }
    setPwdError(null);
    setChangingPwd(true);

    const { ok, error } = await changePassword(currentPassword, newPassword);
    setChangingPwd(false);

    if (!ok) {
      setPwdError(error || 'Não foi possível atualizar a senha.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPwdMsg(true);
    setTimeout(() => setShowPwdMsg(false), 3000);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(user.friendCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard indisponível, ignora silenciosamente
    }
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendCodeInput.trim()) return;
    setAddingFriend(true);
    setAddFriendError(null);

    const { user: updatedUser, error } = await addFriendByCode(friendCodeInput.trim());
    setAddingFriend(false);

    if (error) {
      setAddFriendError(error);
      return;
    }
    if (updatedUser) {
      onUpdateUser(updatedUser);
      setShowAddFriend(false);
      setFriendCodeInput('');
    }
  };

  const handleRemoveFriend = async (friendUserId: string) => {
    const updatedUser = await removeFriendRequest(friendUserId);
    if (updatedUser) {
      onUpdateUser(updatedUser);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteAccountPassword) return;
    setDeletingAccount(true);
    setDeleteAccountError(null);

    const { ok, error } = await deleteAccount(deleteAccountPassword);
    setDeletingAccount(false);

    if (!ok) {
      setDeleteAccountError(error || 'Não foi possível excluir a conta.');
      return;
    }
    onLogout();
  };

  const friendsSortedByDate = [...user.friends].sort(
    (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
  );

  return (
    <div className="animate-in fade-in duration-500 px-6 pt-4">
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

          <form onSubmit={handleUpdatePassword} className="space-y-3">
            <h4 className="text-[10px] text-slate-300 uppercase tracking-widest">Alterar Senha</h4>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                placeholder="Senha atual..."
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 pr-10 text-sm text-slate-700 focus:ring-1 focus:ring-[#646B99] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                {showCurrentPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Nova senha (mín. 8 caracteres)..."
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 pr-10 text-sm text-slate-700 focus:ring-1 focus:ring-[#646B99] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                {showNewPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirmar nova senha..."
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 pr-10 text-sm text-slate-700 focus:ring-1 focus:ring-[#646B99] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <button
              type="submit"
              disabled={changingPwd || !currentPassword || newPassword.length < 8 || !confirmPassword}
              className="w-full px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-xl text-slate-600 text-sm transition-colors disabled:opacity-50"
            >
              {changingPwd ? 'Atualizando...' : 'Atualizar'}
            </button>
            {pwdError && (
              <p className="text-red-500 text-[10px]">{pwdError}</p>
            )}
            {showPwdMsg && (
              <p className="text-emerald-500 text-[10px] uppercase tracking-widest">Senha atualizada com sucesso!</p>
            )}
          </form>
        </section>

        <section className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
          <h4 className="text-[10px] text-slate-300 uppercase tracking-widest mb-3">Seu Código de Amigo</h4>
          <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-100 shadow-sm mb-6">
            <span className="text-sm font-mono font-semibold text-[#646B99] tracking-widest">{formatFriendCode(user.friendCode)}</span>
            <button
              onClick={handleCopyCode}
              className="text-[10px] uppercase tracking-widest font-medium text-slate-400 hover:text-[#646B99] px-2 py-1"
            >
              {codeCopied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mb-4">Compartilhe esse código para que outros treinadores te adicionem.</p>

          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] text-slate-300 uppercase tracking-widest">Gerenciar Amigos ({user.friends.length})</h4>
            <button
              onClick={() => { setShowAddFriend(true); setAddFriendError(null); }}
              className="text-[11px] font-medium text-[#646B99] hover:text-[#4d5275] flex items-center gap-1 bg-white border border-slate-100 px-2.5 py-1 rounded-lg transition-colors shadow-sm"
            >
              + Adicionar Amigo
            </button>
          </div>

          <div className="space-y-2">
            {friendsSortedByDate.length === 0 ? (
              <p className="text-slate-400 italic text-xs">Nenhum amigo adicionado.</p>
            ) : (
              friendsSortedByDate.map(friend => (
                <div key={friend.userId} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#646B99]/10 flex items-center justify-center text-[#646B99] font-bold text-xs flex-shrink-0">
                      {friend.username[0]?.toUpperCase()}
                    </div>
                    <div>
                      <span className="text-slate-700 text-sm block">{friend.username}</span>
                      <span className="text-slate-400 text-[10px]">Adicionado em {formatAddedAt(friend.addedAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveFriend(friend.userId)}
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

        <button
          onClick={() => { setShowDeleteAccount(true); setDeleteAccountError(null); setDeleteAccountPassword(''); }}
          className="w-full py-3 text-red-300 hover:text-red-500 transition-colors uppercase tracking-[0.2em] text-[9px]"
        >
          Excluir minha conta permanentemente
        </button>
      </div>

      {showAddFriend && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 w-full max-w-xs rounded-2xl shadow-2xl p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Adicionar Amigo</h3>
            <p className="text-[10px] text-slate-400 mb-4">Peça o código de amigo dele(a) e insira abaixo.</p>

            <form onSubmit={handleAddFriend}>
              <input
                type="text"
                placeholder="Ex: K7M2-XQPR"
                value={friendCodeInput}
                onChange={(e) => setFriendCodeInput(e.target.value)}
                autoFocus
                className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs text-slate-700 uppercase tracking-widest outline-none focus:ring-1 focus:ring-[#646B99] mb-2"
              />
              {addFriendError && (
                <p className="text-red-500 text-[10px] mb-2">{addFriendError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddFriend(false); setFriendCodeInput(''); setAddFriendError(null); }}
                  className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!friendCodeInput.trim() || addingFriend}
                  className="flex-1 py-2 bg-[#646B99] text-white text-xs font-semibold rounded-lg hover:bg-[#4d5275] transition-colors disabled:opacity-50"
                >
                  {addingFriend ? 'Adicionando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 w-full max-w-xs rounded-2xl shadow-2xl p-6">
            <h3 className="text-sm font-semibold text-red-500 mb-1">Excluir conta permanentemente</h3>
            <p className="text-[10px] text-slate-400 mb-4">
              Essa ação é irreversível. Sua coleção, pastas, lista de desejos, amizades e trocas serão apagadas para sempre. Confirme sua senha para continuar.
            </p>

            <form onSubmit={handleDeleteAccount}>
              <input
                type="password"
                placeholder="Sua senha"
                autoComplete="current-password"
                value={deleteAccountPassword}
                onChange={(e) => setDeleteAccountPassword(e.target.value)}
                autoFocus
                className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-red-300 mb-2"
              />
              {deleteAccountError && (
                <p className="text-red-500 text-[10px] mb-2">{deleteAccountError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => { setShowDeleteAccount(false); setDeleteAccountPassword(''); setDeleteAccountError(null); }}
                  className="flex-1 py-2 bg-slate-50 text-slate-400 text-xs rounded-lg hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!deleteAccountPassword || deletingAccount}
                  className="flex-1 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {deletingAccount ? 'Excluindo...' : 'Excluir conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
