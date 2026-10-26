import { api } from './lib';
import { loadStored, saveStored } from './storage';
export interface ActivityEntry {
  id: string;
  flowId: string;
  account: string;
  marketId: string;
  at: number;
  state:
    | 'draft'
    | 'reviewed'
    | 'signature'
    | 'pending'
    | 'unknown'
    | 'rejected'
    | 'confirmed'
    | 'reverted'
    | 'syncing'
    | 'resting'
    | 'partial'
    | 'filled'
    | 'cancelled'
    | 'journaled';
  hash?: string;
  detail: string;
  source?: string;
}
const key = 'perpshq.activityOutbox';
export function activityFlowForHash(hash?: string) {
  if (!hash) return crypto.randomUUID();
  return (
    loadStored<Record<string, string>>(localStorage, 'perpshq.orderFlows', {})[
      hash.toLowerCase()
    ] ?? crypto.randomUUID()
  );
}
export function recordActivity(entry: Omit<ActivityEntry, 'id' | 'at'>) {
  const event: ActivityEntry = { ...entry, id: crypto.randomUUID(), at: Date.now() };
  if (event.hash) {
    const flows = loadStored<Record<string, string>>(localStorage, 'perpshq.orderFlows', {});
    saveStored(
      localStorage,
      'perpshq.orderFlows',
      { ...flows, [event.hash.toLowerCase()]: event.flowId },
      {},
    );
  }
  try {
    const pending = loadStored<ActivityEntry[]>(localStorage, key, []);
    saveStored(localStorage, key, [...pending, event].slice(-1000), []);
  } catch {
    window.dispatchEvent(
      new CustomEvent('perpshq-storage-error', {
        detail:
          'Order activity could not be saved. Export your workspace and check browser storage.',
      }),
    );
  }
  void flushActivity();
}
let flushing = false;
export async function flushActivity() {
  if (flushing) return;
  flushing = true;
  try {
    const pending = loadStored<ActivityEntry[]>(localStorage, key, []);
    for (const event of pending) {
      await api('/workspace/activity', event);
      const latest = loadStored<ActivityEntry[]>(localStorage, key, []);
      saveStored(
        localStorage,
        key,
        latest.filter((v) => v.id !== event.id),
        [],
      );
    }
  } catch {
    /* Keep the durable outbox for the next browser/API connection. */
  } finally {
    flushing = false;
  }
}
