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
    friends: user.friends,
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

export const logout = () => {
  clearToken();
};
