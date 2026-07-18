
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { registerUser, loginUser, AuthError } from '../auth';

interface LoginViewProps {
  onLogin: (user: User) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [showSplash, setShowSplash] = useState(true);
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
        // Splash aguarda interação ou tempo
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.password) return;
    setError(null);
    setSubmitting(true);

    try {
      const user = isRegister
        ? await registerUser(formData.username || 'Treinador', formData.email, formData.password)
        : await loginUser(formData.email, formData.password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Não foi possível conectar ao servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  if (showSplash) {
    return (
      <div
        className="min-h-screen bg-[#FBF2E1] flex flex-col items-center justify-center p-6 cursor-pointer animate-in fade-in duration-700"
        onClick={() => setShowSplash(false)}
      >
        <div className="flex flex-col items-center gap-2">
            <img src="/logo.svg" alt="TCG Collector" className="w-56 h-auto mb-4" />
            <p className="mt-20 text-[10px] text-slate-400 uppercase animate-pulse tracking-widest">Toque para iniciar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 animate-in slide-in-from-bottom duration-500">
      <div className="w-full max-w-sm space-y-12">
        <div className="text-center">
          <h2 className="text-3xl text-slate-900 tracking-tight">Bem-vindo</h2>
          <p className="text-slate-400 text-xs uppercase tracking-widest mt-2">Sua jornada começa aqui</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {isRegister && (
            <div className="space-y-1">
              <input 
                type="text" 
                placeholder="NOME DE USUÁRIO"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
                className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs tracking-widest text-slate-900 outline-none focus:border-[#646B99] transition-colors"
              />
            </div>
          )}

          <input
            type="email"
            placeholder="E-MAIL"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs tracking-widest text-slate-900 outline-none focus:border-[#646B99] transition-colors"
          />

          <input
            type="password"
            placeholder="SENHA"
            value={formData.password}
            onChange={(e) => setFormData({...formData, password: e.target.value})}
            className="w-full bg-slate-50 border-b-2 border-slate-100 px-0 py-4 text-xs tracking-widest text-slate-900 outline-none focus:border-[#646B99] transition-colors"
          />

          {error && (
            <p className="text-red-500 text-[10px] uppercase tracking-widest text-center">{error}</p>
          )}

          <div className="pt-6">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-5 bg-slate-900 text-white text-xs rounded-full hover:bg-slate-800 transition-all shadow-xl uppercase tracking-[0.3em] disabled:opacity-50"
            >
              {submitting ? 'Aguarde...' : isRegister ? 'Criar Registro' : 'Acessar Pasta'}
            </button>
          </div>

          <button 
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="w-full text-center text-slate-400 text-[9px] uppercase tracking-widest hover:text-slate-600 transition-colors"
          >
            {isRegister ? 'Já sou treinador' : 'Novo por aqui? Registrar'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginView;
