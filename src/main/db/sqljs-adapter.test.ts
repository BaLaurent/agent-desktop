import { initMemoryAdapter, SqlJsAdapter } from './sqljs-adapter'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
}))

describe('SqlJsAdapter', () => {
  let db: SqlJsAdapter

  beforeEach(async () => {
    db = await initMemoryAdapter()
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value INTEGER)')
  })

  afterEach(() => {
    db.close()
  })

  describe('prepare().run()', () => {
    it('returns lastInsertRowid and changes', () => {
      const result = db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('a', 1)
      expect(result.lastInsertRowid).toBe(1)
      expect(result.changes).toBe(1)
    })

    it('increments rowid on successive inserts', () => {
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('a', 1)
      const result = db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('b', 2)
      expect(result.lastInsertRowid).toBe(2)
    })
  })

  describe('prepare().get()', () => {
    it('returns undefined for no rows', () => {
      const row = db.prepare('SELECT * FROM test WHERE id = ?').get(999)
      expect(row).toBeUndefined()
    })

    it('returns object for matching row', () => {
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('hello', 42)
      const row = db.prepare('SELECT * FROM test WHERE name = ?').get('hello') as { name: string; value: number }
      expect(row.name).toBe('hello')
      expect(row.value).toBe(42)
    })
  })

  describe('prepare().all()', () => {
    it('returns empty array for no rows', () => {
      const rows = db.prepare('SELECT * FROM test').all()
      expect(rows).toEqual([])
    })

    it('returns all matching rows', () => {
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('a', 1)
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('b', 2)
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('c', 3)
      const rows = db.prepare('SELECT * FROM test ORDER BY id').all()
      expect(rows).toHaveLength(3)
      expect((rows[0] as { name: string }).name).toBe('a')
      expect((rows[2] as { name: string }).name).toBe('c')
    })
  })

  describe('exec()', () => {
    it('executes DDL statements', () => {
      db.exec('CREATE TABLE test2 (id INTEGER PRIMARY KEY)')
      db.prepare('INSERT INTO test2 (id) VALUES (1)').run()
      const row = db.prepare('SELECT id FROM test2').get() as { id: number }
      expect(row.id).toBe(1)
    })
  })

  describe('pragma()', () => {
    it('sets pragma without error', () => {
      expect(() => db.pragma('journal_mode = WAL')).not.toThrow()
    })

    it('queries table_info and returns array of objects', () => {
      const cols = db.pragma('table_info(test)') as { name: string }[]
      const names = cols.map((c) => c.name)
      expect(names).toContain('id')
      expect(names).toContain('name')
      expect(names).toContain('value')
    })

    it('queries foreign_keys pragma value', () => {
      db.pragma('foreign_keys = ON')
      const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
      expect(result).toHaveLength(1)
      expect(result[0].foreign_keys).toBe(1)
    })
  })

  describe('transaction()', () => {
    it('commits on success', () => {
      const insert = db.transaction(() => {
        db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('tx1', 10)
        db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('tx2', 20)
      })
      insert()
      const rows = db.prepare('SELECT * FROM test').all()
      expect(rows).toHaveLength(2)
    })

    it('rolls back on error', () => {
      const failInsert = db.transaction(() => {
        db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run('ok', 1)
        throw new Error('boom')
      })
      expect(() => failInsert()).toThrow('boom')
      const rows = db.prepare('SELECT * FROM test').all()
      expect(rows).toHaveLength(0)
    })
  })

  describe('close()', () => {
    it('is idempotent', () => {
      db.close()
      expect(() => db.close()).not.toThrow()
    })
  })

  describe('undefined params', () => {
    it('treats undefined as null', () => {
      db.prepare('INSERT INTO test (name, value) VALUES (?, ?)').run(undefined, 42)
      const row = db.prepare('SELECT * FROM test WHERE value = ?').get(42) as { name: string | null }
      expect(row.name).toBeNull()
    })
  })
})
