import type { NextFunction, Request, Response } from 'express';
import { supabase } from '../supabase.js';
import { isPremiumUser } from '../premiumStore.js';

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? '';
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// A função de trocas ainda está em fase de testes fechados - só é liberada para
// contas que resgataram um código de acesso (ver routes/premium.ts).
export async function requirePremium(req: AuthedRequest, res: Response, next: NextFunction) {
  const premium = await isPremiumUser(req.userId!);
  if (!premium) {
    return res.status(403).json({ error: 'Funcionalidade disponível apenas para contas liberadas.', code: 'premium_required' });
  }
  next();
}
