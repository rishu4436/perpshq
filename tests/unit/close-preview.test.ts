import { describe, expect, it } from 'vitest';
import { closingPositionFingerprint } from '../../apps/api/src/close-preview';
import type { Plan } from '../../packages/shared-types';
const pool = '0x' + '1'.repeat(40);
const plan = {
  input: { marketId: pool, side: 'short', type: 'market' },
  rawQuantity: '13000',
} as Plan;
const live = {
  exposure: { complete: true },
  positions: [{ pool, size: 13000n, avgEntryPrice: 78000n, entryFundingIndex: 2n }],
};
describe('supervised full-position close gate', () => {
  it('anchors an opposite IOC to the actual current full position', () => {
    expect(closingPositionFingerprint(plan, live)).toBe('13000:78000:2');
  });
  it('blocks a repeated close after the account is flat', () => {
    expect(() => closingPositionFingerprint(plan, { ...live, positions: [] })).toThrow(
      'already flat',
    );
  });
  it('rejects same-side orders, partial/oversized quantities and incomplete snapshots', () => {
    expect(() =>
      closingPositionFingerprint({ ...plan, input: { ...plan.input, side: 'long' } }, live),
    ).toThrow('opposite-side');
    for (const rawQuantity of ['12000', '14000'])
      expect(() => closingPositionFingerprint({ ...plan, rawQuantity }, live)).toThrow(
        'full position',
      );
    expect(() =>
      closingPositionFingerprint(plan, { ...live, exposure: { complete: false } }),
    ).toThrow('complete');
  });
  it('changes the approval anchor when position ownership history changes', () => {
    const next = { ...live, positions: [{ ...live.positions[0], avgEntryPrice: 79000n }] };
    expect(closingPositionFingerprint(plan, next)).not.toBe(closingPositionFingerprint(plan, live));
  });
});
