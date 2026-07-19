import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT || '8787', 10),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  pokemonTcgApiKey: process.env.POKEMONTCG_API_KEY || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
