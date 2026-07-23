import { Pool, QueryResult } from 'pg'

export interface Database {
  query(text: string, values?: any[]): Promise<QueryResult | any>
}

export function createDatabase(pool: Pool): Database {
  return {
    async query(text: string, values?: any[]) {
      const result = await pool.query(text, values)
      return result.rows
    },
  }
}

export type { Pool }
