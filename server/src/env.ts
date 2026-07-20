import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// CLIENT_ORIGIN aceita uma lista separada por vírgulas (ex: domínio com e sem "www",
// já que a Vercel costuma redirecionar um pro outro e o navegador exige que o
// Access-Control-Allow-Origin bata exatamente com a origem que ele está usando).
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  port: parseInt(process.env.PORT || '8787', 10),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  clientOrigins,
  pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
