// Minimal ambient declaration for sql.js (ships no types, @types/sql.js absent).
// Covers only the surface consumed by src/core/db/sqljs-adapter.ts.
declare module 'sql.js' {
  export interface Statement {
    bind(params: unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, unknown>
    free(): boolean
  }

  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null)
    prepare(sql: string): Statement
    run(sql: string, params?: unknown[]): Database
    exec(sql: string): QueryExecResult[]
    getRowsModified(): number
    export(): Uint8Array
    close(): void
  }

  export interface SqlJsStatic {
    Database: typeof Database
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>
}
