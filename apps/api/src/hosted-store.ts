import { neon } from '@neondatabase/serverless';
export class HostedStorageError extends Error {
  constructor() {
    super(
      'Strategy storage is unavailable. Preserve unresolved requests and retry reconciliation.',
    );
  }
}
export interface Document<T = unknown> {
  revision: number;
  value: T;
}
export interface DocumentStore {
  get<T>(key: string): Promise<Document<T> | null>;
  create(key: string, value: unknown, expiresAt?: number): Promise<boolean>;
  swap(key: string, revision: number, value: unknown, expiresAt?: number): Promise<boolean>;
}
export function postgresStore(connection: string): DocumentStore {
  const sql = neon(connection);
  let ready: Promise<unknown> | undefined;
  async function query(text: string, params: unknown[] = []) {
    try {
      ready ??= sql
        .query(
          `CREATE TABLE IF NOT EXISTS perpshq_hosted_documents (
      key text PRIMARY KEY, revision integer NOT NULL DEFAULT 1, value jsonb NOT NULL,
      expires_at bigint, updated_at timestamptz NOT NULL DEFAULT now()
    )`,
        )
        .catch((error: unknown) => {
          ready = undefined;
          throw error;
        });
      await ready;
      return await sql.query(text, params, {
        fetchOptions: { signal: AbortSignal.timeout(15000) },
      });
    } catch {
      throw new HostedStorageError();
    }
  }
  return {
    async get<T>(key: string) {
      const rows = await query(
        'SELECT revision,value FROM perpshq_hosted_documents WHERE key=$1 AND (expires_at IS NULL OR expires_at>$2)',
        [key, Date.now()],
      );
      return rows[0] ? { revision: rows[0].revision as number, value: rows[0].value as T } : null;
    },
    async create(key, value, expiresAt) {
      const rows = await query(
        'INSERT INTO perpshq_hosted_documents(key,value,expires_at) VALUES($1,$2::jsonb,$3) ON CONFLICT DO NOTHING RETURNING revision',
        [key, JSON.stringify(value), expiresAt ?? null],
      );
      return rows.length === 1;
    },
    async swap(key, revision, value, expiresAt) {
      const rows = await query(
        'UPDATE perpshq_hosted_documents SET value=$3::jsonb,revision=revision+1,expires_at=$4,updated_at=now() WHERE key=$1 AND revision=$2 AND (expires_at IS NULL OR expires_at>$5) RETURNING revision',
        [key, revision, JSON.stringify(value), expiresAt ?? null, Date.now()],
      );
      return rows.length === 1;
    },
  };
}
