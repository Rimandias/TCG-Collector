// Gera N códigos de acesso para liberar a função de Trocas (fase de teste fechado).
// Uso: node scripts/generate-access-codes.js [quantidade]
// Cada código só pode ser resgatado uma vez (ver premiumStore.ts / rota /api/premium/redeem).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para evitar confusão

function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

const quantity = parseInt(process.argv[2] || '1', 10);
if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
  console.error('Quantidade inválida. Uso: node scripts/generate-access-codes.js [quantidade entre 1 e 500]');
  process.exit(1);
}

const codes = Array.from({ length: quantity }, () => generateCode());

const { error } = await supabase.from('access_codes').insert(codes.map((code) => ({ code })));
if (error) {
  console.error('Erro ao inserir códigos:', error.message);
  process.exit(1);
}

console.log(`${quantity} código(s) gerado(s):\n`);
codes.forEach((code) => console.log(code));
