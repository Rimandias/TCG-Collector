import { User } from './types';
import { supabase } from './supabaseClient';

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

export const persistUser = async (user: User): Promise<User | null> => {
  const token = await getAccessToken();
  if (!token) return null;

  const payload = {
    username: user.username,
    avatarUrl: user.avatarUrl,
    ownedCards: user.ownedCards,
    folders: user.folders || [],
    wishlist: user.wishlist || [],
  };

  const response = await fetch(`${API_BASE}/users/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn('Falha ao salvar dados no servidor:', await parseErrorMessage(response, response.statusText));
    return null;
  }

  const body = await response.json();
  return body.user;
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
