import type { NextFunction, Request, Response } from 'express';
import { supabase } from '../supabase.js';

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
