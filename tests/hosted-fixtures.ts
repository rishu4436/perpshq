import type { Document, DocumentStore } from '../apps/api/src/hosted-store';
// Model Postgres JSONB: JSON serialization and reordered object keys on read.
function jsonb(value: unknown): unknown {
  const parsed = JSON.parse(JSON.stringify(value));
  const reorder = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reorder)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, item]) => [k, reorder(item)]),
          )
        : v;
  return reorder(parsed);
}
/** Explicit in-memory test double, never selected by application configuration. */
export class MemoryDocuments implements DocumentStore {
  values = new Map<string, { document: Document; expiresAt?: number }>();
  async get<T>(key: string) {
    const row = this.values.get(key);
    return row && (!row.expiresAt || row.expiresAt > Date.now())
      ? (jsonb(row.document) as Document<T>)
      : null;
  }
  async create(key: string, value: unknown, expiresAt?: number) {
    if (this.values.has(key)) return false;
    this.values.set(key, { document: { revision: 1, value: structuredClone(value) }, expiresAt });
    return true;
  }
  async swap(key: string, revision: number, value: unknown, expiresAt?: number) {
    const row = this.values.get(key);
    if (!row || row.document.revision !== revision) return false;
    this.values.set(key, {
      document: { revision: revision + 1, value: structuredClone(value) },
      expiresAt,
    });
    return true;
  }
}
