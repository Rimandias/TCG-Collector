import { User, UserCardData } from './types';
import { supabase } from './supabaseClient';
import { computeCardsDiff } from './db';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

export class AuthError extends Error {}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

function mapAuthErrorMessage(message: string): string {
  if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (message.includes('User already registered')) return 'Já existe uma conta com este e-mail.';
  if (message.toLowerCase().includes('password should be at least')) return 'A senha deve ter pelo menos 6 caracteres.';
  if (message.toLowerCase().includes('rate limit')) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
  return message;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// O backend (Render, plano hobby) hiberna depois de um tempo sem requisição e leva dezenas
// de segundos pra "acordar" na chamada seguinte - se essa chamada for justo o primeiro
// PUT /users/me depois do usuário ficar parado um tempo só navegando (sem nenhuma edição
// disparando request pro servidor), o cold-start podia sozinho estourar o timeout de
// persistUser. Chamado no carregamento do app e sempre que a aba volta a ficar visível
// depois de escondida (App.tsx) - fire-and-forget, sem bloquear nada e sem checar o
// resultado: o objetivo é só garantir que o servidor já esteja acordado ANTES do usuário
// mexer em alguma carta, não sincronizar dado nenhum.
export function warmBackend(): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  fetch(`${API_BASE}/health`, { signal: controller.signal })
    .catch(() => {
      // Falha silenciosa - se o servidor realmente estiver fora do ar, o próximo
      // salvamento vai reportar isso normalmente (fluxo de erro/retry já existente).
    })
    .finally(() => clearTimeout(timer));
}

async function fetchAppUser(): Promise<User> {
  const token = await getAccessToken();
  if (!token) throw new AuthError('Sessão não encontrada.');

  const response = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new AuthError(await parseErrorMessage(response, 'Não foi possível carregar os dados da conta.'));
  }
  const body = await response.json();
  return body.user;
}

export const registerUser = async (username: string, email: string, password: string): Promise<User> => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username || 'Treinador' },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw new AuthError(mapAuthErrorMessage(error.message));
  if (!data.session) {
    throw new AuthError('Conta criada! Verifique seu e-mail para confirmar o cadastro antes de entrar.');
  }
  return fetchAppUser();
};

export const loginUser = async (email: string, password: string): Promise<User> => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AuthError(mapAuthErrorMessage(error.message));
  return fetchAppUser();
};

export const fetchCurrentUser = async (): Promise<User | null> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  try {
    return await fetchAppUser();
  } catch {
    return null;
  }
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw new AuthError(mapAuthErrorMessage(error.message));
};

export const updatePassword = async (newPassword: string): Promise<void> => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthError(mapAuthErrorMessage(error.message));
};

// O PUT devolve só um ack mínimo ({ ok: true }), não a coleção inteira de volta - nenhum
// caller usava esse retorno pra nada além de checar sucesso/falha (o próprio `user` que
// disparou o salvamento já é a fonte da verdade no estado do React), então reenviar tudo de
// volta a cada salvamento era banda jogada fora.
//
// Sem timeout aqui, uma conexão que trava no meio do caminho (rede instável, aba suspensa
// pelo SO, proxy derrubando conexão ociosa) deixava o fetch pendurado pra sempre: a promise
// nunca resolve nem rejeita, então em App.tsx isSavingRef/saveState ficavam presos em
// "saving" para sempre (overlay "Salvando..." travado) e o retry automático - que só dispara
// quando saveState vira "error" - nunca chegava a acionar. 45s dá folga pra coleções grandes
// (a rota faz várias queries/upserts em paralelo no servidor) e pro cold-start do Render
// (ver warmBackend, que tenta evitar cair nesse caso) sem deixar o usuário esperando
// indefinidamente por uma conexão que já morreu.
//
// `baseline` é o último estado de `ownedCards` confirmado como salvo (ver lastSyncedCardsRef
// em App.tsx) - quando informado, manda só o diff calculado contra ele (cardsDiff), em vez da
// coleção inteira; App.tsx só avança esse baseline depois de um salvamento bem-sucedido, então
// uma falha nunca "esquece" uma mudança - o próximo diff recalculado contra o baseline antigo
// já inclui tudo que ficou pendente. Sem `baseline` (ex: importação de CSV em
// SettingsView.tsx, que salva direto sem passar pelo pipeline de debounce), continua mandando
// `ownedCards` inteiro como sempre - o servidor aceita os dois formatos.
export const persistUser = async (user: User, baseline?: Record<string, UserCardData>): Promise<boolean> => {
  const token = await getAccessToken();
  if (!token) return false;

  const payload: Record<string, any> = {
    username: user.username,
    avatarUrl: user.avatarUrl,
    folders: user.folders || [],
    wishlist: user.wishlist || [],
  };
  if (baseline) {
    payload.cardsDiff = computeCardsDiff(baseline, user.ownedCards);
  } else {
    payload.ownedCards = user.ownedCards;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${API_BASE}/users/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn('Falha ao salvar dados no servidor:', await parseErrorMessage(response, response.statusText));
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Falha ao salvar dados no servidor:', err);
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const addFriendByCode = async (code: string): Promise<{ user?: User; error?: string }> => {
  const token = await getAccessToken();
  if (!token) return { error: 'Sessão expirada, faça login novamente.' };

  const response = await fetch(`${API_BASE}/friends`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    return { error: await parseErrorMessage(response, 'Não foi possível adicionar o amigo.') };
  }

  const body = await response.json();
  return { user: body.user };
};

export const removeFriend = async (friendUserId: string): Promise<User | null> => {
  const token = await getAccessToken();
  if (!token) return null;

  const response = await fetch(`${API_BASE}/friends/${encodeURIComponent(friendUserId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) return null;
  const body = await response.json();
  return body.user;
};

export const changePassword = async (currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> => {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) return { ok: false, error: 'Sessão expirada, faça login novamente.' };

  // Reautentica com a senha atual antes de trocar - evita que uma sessão vazada
  // sozinha seja suficiente para assumir a conta.
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) return { ok: false, error: 'Senha atual incorreta.' };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: mapAuthErrorMessage(error.message) };
  return { ok: true };
};

export const deleteAccount = async (password: string): Promise<{ ok: boolean; error?: string }> => {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) return { ok: false, error: 'Sessão expirada, faça login novamente.' };

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password });
  if (reauthError) return { ok: false, error: 'Senha incorreta.' };

  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Sessão expirada, faça login novamente.' };

  const response = await fetch(`${API_BASE}/users/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return { ok: false, error: await parseErrorMessage(response, 'Não foi possível excluir a conta.') };
  }
  await supabase.auth.signOut();
  return { ok: true };
};

export const logout = async (): Promise<void> => {
  await supabase.auth.signOut();
};
