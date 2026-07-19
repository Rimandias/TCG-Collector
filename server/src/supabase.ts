import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Cliente com a service_role key: ignora RLS por design (só o backend fala com o Postgres,
// o frontend nunca acessa essas tabelas diretamente, só o Supabase Auth).
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
