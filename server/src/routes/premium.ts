import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { assembleFullUser } from '../userStore.js';
import { redeemAccessCode } from '../premiumStore.js';
import { asyncHandler } from '../asyncHandler.js';

export const premiumRouter = Router();

// Limite apertado: resgate de código é um alvo natural de força bruta.
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const redeemSchema = z.object({
  code: z.string().trim().min(4).max(40),
});

premiumRouter.post(
  '/redeem',
  redeemLimiter,
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const result = await redeemAccessCode(req.userId!, parsed.data.code);
    if (!result.ok) {
      const message =
        result.reason === 'already_premium'
          ? 'Sua conta já está liberada.'
          : 'Código inválido ou já utilizado.';
      return res.status(400).json({ error: message });
    }

    const user = await assembleFullUser(req.userId!, req.userEmail!);
    return res.json({ user });
  })
);
