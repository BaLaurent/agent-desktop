import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// Statement — wraps sql.js to mimic better-sqlite3's Statement API
// ---------------------------------------------------------------------------

class Statement {
  constructor(
    private db: SqlJsDatabase,
    private sql: string,
    private adapter: SqlJsAdapter
  ) {}

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql)
    try {
      if (params.length) stmt.bind(normParams(params))
      if (!stmt.step()) return undefined
      return stmt.getAsObject() as Record<string, unknown>
    } finally {
      stmt.free()
    }
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.sql)
    try {
      if (params.length) stmt.bind(normParams(params))
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>)
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number } {
    const stmt = this.db.prepare(this.sql)
    try {
      if (params.length) stmt.bind(normParams(params))
      stmt.step()
    } finally {
      stmt.free()
    }
    this.adapter.markDirty()
    const rowid = (this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) as number
    return { lastInsertRowid: rowid, changes: this.db.getRowsModified() }
  }
}

// ---------------------------------------------------------------------------
// SqlJsAdapter — drop-in replacement for better-sqlite3's Database
// ---------------------------------------------------------------------------

export class SqlJsAdapter {
  private db: SqlJsDatabase
  private dbPath: string | null
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(db: SqlJsDatabase, dbPath: string | null) {
    this.db = db
    this.dbPath = dbPath
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql, this)
  }

  exec(sql: string): void {
    this.db.run(sql)
    // exec can be DDL or DML — always mark dirty for safety
    this.markDirty()
  }

  pragma(pragmaStr: string): unknown {
    // better-sqlite3 syntax: pragma('journal_mode = WAL') or pragma('table_info(conversations)')
    const eqIdx = pragmaStr.indexOf('=')
    if (eqIdx !== -1) {
      // SET pragma — e.g. 'journal_mode = WAL'
      this.db.run(`PRAGMA ${pragmaStr}`)
      return undefined
    }
    // QUERY pragma — e.g. 'table_info(conversations)'
    const results = this.db.exec(`PRAGMA ${pragmaStr}`)
    if (!results.length) return []
    const { columns, values } = results[0]
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = row[i]
      }
      return obj
    })
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]) => {
      this.db.run('BEGIN')
      try {
        const result = fn(...args)
        this.db.run('COMMIT')
        this.markDirty()
        return result
      } catch (err) {
        this.db.run('ROLLBACK')
        throw err
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.db.close()
    this.closed = true
  }

  /** Mark DB as having pending changes — debounces flush to disk */
  markDirty(): void {
    if (!this.dbPath) return // :memory: — no persistence
    this.dirty = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flush(), 500)
  }

  /** Synchronous flush — writes DB to disk immediately */
  flush(): void {
    if (!this.dirty || !this.dbPath) return
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const data = this.db.export()
    const dir = path.dirname(this.dbPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.dbPath, Buffer.from(data))
    this.dirty = false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize params: better-sqlite3 takes positional args, sql.js needs an array */
function normParams(params: unknown[]): unknown[] {
  // better-sqlite3 allows prepare(sql).run(a, b, c) — flat positional params
  // sql.js .bind() also takes an array — just pass through
  // Handle null → null (sql.js accepts null)
  return params.map((p) => (p === undefined ? null : p))
}

function resolveWasmPath(): string | undefined {
  // In packaged app: WASM is in extraResources
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'sql-wasm.wasm')
    }
  } catch {
    // app not available (test environment) — fall through
  }
  // Dev / test: sql.js resolves WASM from node_modules automatically
  return undefined
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export async function initAdapter(dbPath: string): Promise<SqlJsAdapter> {
  const wasmPath = resolveWasmPath()
  const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined)

  let db: SqlJsDatabase
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  return new SqlJsAdapter(db, dbPath)
}

export async function initMemoryAdapter(): Promise<SqlJsAdapter> {
  const wasmPath = resolveWasmPath()
  const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined)
  const db = new SQL.Database()
  return new SqlJsAdapter(db, null)
}
