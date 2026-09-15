declare module 'mysql' {
  interface PoolConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionLimit?: number;
    waitForConnections?: boolean;
  }

  interface QueryCallback {
    (error: Error | null, results?: unknown, fields?: unknown): void;
  }

  interface Pool {
    query(sql: string, callback: QueryCallback): void;
    query(sql: string, values: readonly unknown[], callback: QueryCallback): void;
  }

  function createPool(config: PoolConfig): Pool;

  const mysql: { createPool: typeof createPool };
  export = mysql;
}