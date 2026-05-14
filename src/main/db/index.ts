import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let db: DatabaseType | null = null

export function getDb(): DatabaseType {
  if (db) return db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'mucka.db')

  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function migrate(d: DatabaseType): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      colour TEXT NOT NULL DEFAULT 'cream',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts DESC);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      role TEXT NOT NULL,
      segments_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_ts_idx ON chat_messages(ts ASC);
    CREATE TABLE IF NOT EXISTS memories (
      topic TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_type_idx ON memories(type);
    CREATE INDEX IF NOT EXISTS memories_updated_idx ON memories(updated_at DESC);
  `)

  // Idempotent column additions for older databases.
  const cols = d.prepare<[], { name: string }>(`PRAGMA table_info(agents)`).all()
  const colNames = new Set(cols.map((c) => c.name))
  if (!colNames.has('needs_attention')) {
    d.exec(`ALTER TABLE agents ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0`)
  }
  if (!colNames.has('attention_reason')) {
    d.exec(`ALTER TABLE agents ADD COLUMN attention_reason TEXT`)
  }
  if (!colNames.has('preview_url')) {
    d.exec(`ALTER TABLE agents ADD COLUMN preview_url TEXT`)
  }
  if (!colNames.has('vercel_project_id')) {
    d.exec(`ALTER TABLE agents ADD COLUMN vercel_project_id TEXT`)
  }
}
