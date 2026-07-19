import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Configuração do Supabase ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
}

// Usa sessionStorage (não localStorage) para a sessão: cada aba do navegador fica
// com sua própria sessão isolada, em vez de compartilhar (e sobrescrever) a mesma
// sessão entre todas as abas da mesma janela/navegador. Isso é o que permite testar
// duas contas diferentes em duas abas do mesmo navegador sem uma "roubar" a sessão
// da outra. O efeito colateral é que a sessão não sobrevive ao fechar a aba - é o
// comportamento esperado para um app onde cada aba representa uma sessão própria.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
