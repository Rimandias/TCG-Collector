import React, { useState } from 'react';
import { updatePassword, AuthError } from '../auth';

interface ResetPasswordViewProps {
  onDone: () => void;
}

const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({ onDone }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Não foi possível atualizar a senha.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 animate-in slide-in-from-bottom duration-500">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center">
          <h2 className="text-3xl text-slate-900 tracking-tight">Nova Senha</h2>
          <p className="text-slate-400 text-xs uppercase tracking-widest mt-2">Defina uma nova senha de acesso</p>
        </div>

        {success ? (
          <div className="space-y-6 text-center">
            <p className="text-emerald-500 text-sm">Senha atualizada com sucesso!</p>
            <button
              onClick={onDone}
              className="w-full py-5 bg-slate-900 text-white text-xs rounded-full hover:bg-slate-800 transition-all shadow-xl uppercase tracking-[0.3em]"
            >
              Continuar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <input
              type="password"
              placeholder="NOVA SENHA"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs uppercase tracking-widest text-slate-900 outline-none focus:border-[#646B99] transition-colors"
            />
            <input
              type="password"
              placeholder="CONFIRME A SENHA"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs uppercase tracking-widest text-slate-900 outline-none focus:border-[#646B99] transition-colors"
            />

            {error && <p className="text-red-500 text-[10px] uppercase tracking-widest text-center">{error}</p>}

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-5 bg-slate-900 text-white text-xs rounded-full hover:bg-slate-800 transition-all shadow-xl uppercase tracking-[0.3em] disabled:opacity-50"
              >
                {submitting ? 'Aguarde...' : 'Salvar Nova Senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordView;
