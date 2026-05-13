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
  `)
}
