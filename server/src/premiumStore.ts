import { supabase } from './supabase.js';

export async function isPremiumUser(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('is_premium').eq('id', userId).maybeSingle();
  if (error) throw error;
  return !!data?.is_premium;
}

export type RedeemResult =
  | { ok: true }
  | { ok: false; reason: 'already_premium' | 'invalid_code' };

// Resgate atômico: o UPDATE só afeta a linha se ela ainda não tiver sido resgatada
// (redeemed_by is null), então duas pessoas tentando o mesmo código ao mesmo tempo
// não conseguem "empatar" - só uma das requisições afeta alguma linha.
export async function redeemAccessCode(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();

  const alreadyPremium = await isPremiumUser(userId);
  if (alreadyPremium) return { ok: false, reason: 'already_premium' };

  const { data, error } = await supabase
    .from('access_codes')
    .update({ redeemed_by: userId, redeemed_at: new Date().toISOString() })
    .eq('code', code)
    .is('redeemed_by', null)
    .select('code');
  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, reason: 'invalid_code' };

  const { error: profileErr } = await supabase.from('profiles').update({ is_premium: true }).eq('id', userId);
  if (profileErr) throw profileErr;

  return { ok: true };
}
