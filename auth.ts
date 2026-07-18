import { User } from './types';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';
const TOKEN_KEY = 'poketracker_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class AuthError extends Error {}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export const registerUser = async (username: string, email: string, password: string): Promise<User> => {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!response.ok) {
    throw new AuthError(await parseErrorMessage(response, 'Não foi possível criar a conta.'));
  }
  const body = await response.json();
  setToken(body.token);
  return body.user;
};

export const loginUser = async (email: string, password: string): Promise<User> => {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new AuthError(await parseErrorMessage(response, 'E-mail ou senha incorretos.'));
  }
  const body = await response.json();
  setToken(body.token);
  return body.user;
};

export const fetchCurrentUser = async (): Promise<User | null> => {
  const token = getToken();
  if (!token) return null;

  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    clearToken();
    return null;
  }
  const body = await response.json();
  return body.user;
};

export const persistUser = async (user: User): Promise<User | null> => {
  const token = getToken();
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
  const token = getToken();
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
  const token = getToken();
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
  const token = getToken();
  if (!token) return { ok: false, error: 'Sessão expirada, faça login novamente.' };

  const response = await fetch(`${API_BASE}/auth/password`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!response.ok) {
    return { ok: false, error: await parseErrorMessage(response, 'Não foi possível atualizar a senha.') };
  }
  return { ok: true };
};

export const deleteAccount = async (password: string): Promise<{ ok: boolean; error?: string }> => {
  const token = getToken();
  if (!token) return { ok: false, error: 'Sessão expirada, faça login novamente.' };

  const response = await fetch(`${API_BASE}/auth/me`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    return { ok: false, error: await parseErrorMessage(response, 'Não foi possível excluir a conta.') };
  }
  clearToken();
  return { ok: true };
};

export const logout = () => {
  clearToken();
};
