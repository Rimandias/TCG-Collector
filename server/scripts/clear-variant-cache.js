// Apaga as linhas cacheadas de card_variants_cache de um set específico, forçando o backend
// a rebuscar da TCGdex (com a lógica corrigida de detecção de Reverse Foil) na próxima vez
// que alguém abrir uma carta desse set. Sem isso, cartas já cacheadas antes do fix continuam
// mostrando o dado antigo até o TTL de 30 dias expirar sozinho.
// Uso: node scripts/clear-variant-cache.js me04
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const setId = process.argv[2];
if (!setId) {
  console.error('Uso: node scripts/clear-variant-cache.js <setId>  (ex: me04)');
  process.exit(1);
}

const { data, error } = await supabase
  .from('card_variants_cache')
  .delete()
  .like('card_id', `${setId}-%`)
  .select('card_id');

if (error) {
  console.error('Erro ao limpar cache:', error.message);
  process.exit(1);
}

console.log(`${data.length} carta(s) do set "${setId}" removida(s) do cache. Serão rebuscadas da TCGdex na próxima consulta.`);
