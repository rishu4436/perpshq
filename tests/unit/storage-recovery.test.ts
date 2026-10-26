import { describe, expect, it } from 'vitest';
import {
  loadStored,
  saveStored,
  parsePage,
  exportBrowserStorage,
} from '../../apps/web/src/storage';
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
describe('browser recovery', () => {
  it('falls back on malformed and unknown hashes', () => {
    for (const hash of ['#%', '#%E0%A4%A', '#unknown'])
      expect(parsePage(hash, ['Command Center', 'Recovery Center'])).toBe('Command Center');
    expect(parsePage('#Recovery%20Center', ['Recovery Center'])).toBe('Recovery Center');
  });
  it('preserves wrong-shaped data while supplying safe defaults', () => {
    const s = store();
    s.setItem('perpshq.watchlist', '{}');
    expect(loadStored(s, 'perpshq.watchlist', [])).toEqual([]);
    expect(s.getItem('perpshq.watchlist')).toBe('{}');
    expect(s.getItem('perpshq.recovery.perpshq.watchlist')).toBe('{}');
    expect(saveStored(s, 'perpshq.watchlist', ['btc'], [])).toBe(true);
    expect(s.getItem('perpshq.recovery.perpshq.watchlist')).toBe('{}');
  });
  it('validates nested journals, plans and planner contexts', () => {
    const s = store();
    for (const key of ['perpshq.journal', 'perpshq.plans', 'perpshq.alertRules']) {
      s.setItem(key, '[{"id":"broken"}]');
      expect(loadStored(s, key, [])).toEqual([]);
    }
    s.setItem('perpshq.planner.context.test', '{"references":{}}');
    expect(loadStored(s, 'perpshq.planner.context.test', { references: [] })).toEqual({
      references: [],
    });
  });
  it('migrates legacy/v1 values and rejects future versions', () => {
    const s = store();
    s.setItem('perpshq.watchlist', '["btc"]');
    expect(loadStored(s, 'perpshq.watchlist', [])).toEqual(['btc']);
    expect(JSON.parse(s.getItem('perpshq.schemaVersions')!)).toMatchObject({
      'perpshq.watchlist': 1,
    });
    s.setItem('perpshq.timeframe', '{"_perpshqVersion":1,"value":"1h"}');
    expect(loadStored(s, 'perpshq.timeframe', '15m')).toBe('1h');
    s.setItem('perpshq.timeframe', '{"_perpshqVersion":2,"value":"1h"}');
    expect(loadStored(s, 'perpshq.timeframe', '15m')).toBe('15m');
  });
  it('survives denied storage and quota exhaustion', () => {
    const s = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadStored(s, 'perpshq.watchlist', [])).toEqual([]);
    expect(saveStored(s, 'perpshq.watchlist', ['btc'], [])).toBe(false);
    expect(JSON.parse(exportBrowserStorage(s as unknown as Storage)['perpshq.watchlist'])).toEqual([
      'btc',
    ]);
  });
});
