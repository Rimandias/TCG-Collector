import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Usa o SQLite nativo do Node (sem addon C++ pra compilar - evita problemas
// de toolchain nativo em máquinas Windows sem as ferramentas de build corretas).
export const db = new DatabaseSync(path.join(dataDir, 'poketracker.sqlite'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_cards (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    is_owned INTEGER NOT NULL DEFAULT 0,
    is_for_trade INTEGER NOT NULL DEFAULT 0,
    variations TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (user_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS trade_folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    visible_to_friends INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trade_folder_cards (
    folder_id TEXT NOT NULL REFERENCES trade_folders(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    PRIMARY KEY (folder_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    PRIMARY KEY (user_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_user_id)
  );

  CREATE TABLE IF NOT EXISTS sets_cache (
    id TEXT PRIMARY KEY DEFAULT 'all',
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards_cache (
    set_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// --- Migrações leves para bancos criados por versões anteriores do schema ---

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

if (!columnExists('users', 'friend_code')) {
  db.exec('ALTER TABLE users ADD COLUMN friend_code TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code)');

if (!columnExists('trade_folders', 'visible_to_friends')) {
  db.exec('ALTER TABLE trade_folders ADD COLUMN visible_to_friends INTEGER NOT NULL DEFAULT 0');
}

// A tabela `friends` original guardava só um nome de texto livre (sem conta real
// por trás). Se ainda existir nesse formato antigo, recria no formato novo
// (user_id <-> friend_user_id reais), descartando esses dados de demonstração.
if (columnExists('friends', 'friend_name') && !columnExists('friends', 'friend_user_id')) {
  db.exec('DROP TABLE friends');
  db.exec(`
    CREATE TABLE friends (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, friend_user_id)
    )
  `);
}
