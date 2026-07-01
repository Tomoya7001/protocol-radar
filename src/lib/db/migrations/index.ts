import { migration001 } from "./001_init";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Ordered list of migrations. Append new migrations here with a strictly increasing id.
 * The runner applies pending migrations in id order and records each in schema_migrations.
 */
export const migrations: readonly Migration[] = [migration001];
