import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(path.join(dataDir, 'poketracker.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    name TEXT NOT NULL
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
    friend_name TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_name)
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
