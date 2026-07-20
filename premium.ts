import { User } from './types';
import { getAccessToken } from './auth';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

export const redeemAccessCode = async (code: string): Promise<{ user?: User; error?: string }> => {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}/premium/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    return { error: await parseErrorMessage(response, 'Não foi possível liberar o acesso.') };
  }
  const body = await response.json();
  return { user: body.user };
};
