// Lista os códigos de acesso gerados e o status de cada um (resgatado ou não).
// Uso: node scripts/list-access-codes.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: codes, error } = await supabase
  .from('access_codes')
  .select('code, created_at, redeemed_by, redeemed_at')
  .order('created_at', { ascending: true });
if (error) {
  console.error('Erro ao listar códigos:', error.message);
  process.exit(1);
}

const redeemerIds = codes.filter((c) => c.redeemed_by).map((c) => c.redeemed_by);
let usernameById = {};
if (redeemerIds.length > 0) {
  const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', redeemerIds);
  usernameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.username]));
}

for (const c of codes) {
  const status = c.redeemed_by ? `usado por "${usernameById[c.redeemed_by] || '???'}" em ${c.redeemed_at}` : 'disponível';
  console.log(`${c.code}  -  ${status}`);
}
console.log(`\nTotal: ${codes.length} | Disponíveis: ${codes.filter((c) => !c.redeemed_by).length}`);
