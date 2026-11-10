import { describe, expect, it, vi } from 'vitest';
import { discoverWalletProvider } from '../../apps/web/src/wallet-providers';
const wallet = () => ({ request: vi.fn(async () => []) });
function announcement(target: EventTarget, rdns: string, provider: unknown) {
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns }, provider } }),
  );
}
describe('wallet provider discovery', () => {
  it('pins MetaMask even when another wallet owns the legacy injection', () => {
    const target = new EventTarget(),
      binance = wallet(),
      metamask = wallet(),
      changed = vi.fn();
    target.addEventListener('eip6963:requestProvider', () =>
      announcement(target, 'io.metamask', metamask),
    );
    const close = discoverWalletProvider(target, binance, changed);
    expect(changed).toHaveBeenLastCalledWith(metamask);
    announcement(target, 'com.binance', binance);
    announcement(target, 'io.metamask', wallet());
    expect(changed).toHaveBeenLastCalledWith(metamask);
    close();
  });
  it('keeps the single legacy provider usable and ignores malformed announcements', () => {
    const target = new EventTarget(),
      legacy = wallet(),
      changed = vi.fn();
    const close = discoverWalletProvider(target, legacy, changed);
    announcement(target, 'io.metamask', {});
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith(legacy);
    close();
    announcement(target, 'io.metamask', wallet());
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
