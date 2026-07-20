// Revoga (ou concede manualmente) o acesso premium de uma conta específica pelo e-mail.
// Uso: node scripts/revoke-premium.js usuario@exemplo.com [--grant]
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const email = process.argv[2];
const grant = process.argv.includes('--grant');
if (!email) {
  console.error('Uso: node scripts/revoke-premium.js usuario@exemplo.com [--grant]');
  process.exit(1);
}

const { data, error } = await supabase.auth.admin.listUsers();
if (error) {
  console.error('Erro ao buscar usuários:', error.message);
  process.exit(1);
}
const target = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!target) {
  console.error('Nenhuma conta encontrada com esse e-mail.');
  process.exit(1);
}

const { error: updateErr } = await supabase.from('profiles').update({ is_premium: grant }).eq('id', target.id);
if (updateErr) {
  console.error('Erro ao atualizar:', updateErr.message);
  process.exit(1);
}

console.log(`Conta ${email} agora está com is_premium = ${grant}.`);
