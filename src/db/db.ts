import Database from 'better-sqlite3';
import { env } from '../config/env';

export const db = new Database(env.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(table: string, column: string, definition: string): void {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_title TEXT NOT NULL,
      lot_description TEXT NOT NULL,
      lot_style TEXT NOT NULL,
      lot_origin_story TEXT NOT NULL,
      estimated_value_ton REAL NOT NULL DEFAULT 1,
      reserve_price_ton REAL NOT NULL DEFAULT 0.2,
      hype_score INTEGER NOT NULL DEFAULT 50,
      starting_price REAL NOT NULL,
      current_price REAL NOT NULL,
      highest_bidder_id TEXT,
      highest_bidder_name TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      ended_at TEXT,
      winner_id TEXT,
      winner_name TEXT,
      winning_bid REAL
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      bidder_id TEXT NOT NULL,
      bidder_name TEXT NOT NULL,
      bidder_type TEXT NOT NULL,
      amount REAL NOT NULL,
      tx_hash TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'user',
      wins INTEGER NOT NULL DEFAULT 0,
      total_volume REAL NOT NULL DEFAULT 0,
      total_bids INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      winner_id TEXT NOT NULL,
      winner_name TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      payment_address TEXT NOT NULL,
      payment_memo TEXT NOT NULL,
      payment_url TEXT NOT NULL,
      tx_hash TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
    );
  `);

  ensureColumn('auctions', 'estimated_value_ton', 'REAL NOT NULL DEFAULT 1');
  ensureColumn('auctions', 'reserve_price_ton', 'REAL NOT NULL DEFAULT 0.2');
  ensureColumn('auctions', 'hype_score', 'INTEGER NOT NULL DEFAULT 50');
  ensureColumn('users', 'entity_type', "TEXT NOT NULL DEFAULT 'user'");
}
