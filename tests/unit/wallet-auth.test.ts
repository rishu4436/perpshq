import { expect, it } from 'vitest';
import { createSiweMessage } from 'viem/siwe';
import { assertWalletChallenge } from '../../apps/web/src/wallet-auth';
const owner = '0x1111111111111111111111111111111111111111',
  origin = 'https://perps.test',
  id = 'TEST-REQUEST',
  now = 1794280000000;
function message(overrides = {}) {
  return createSiweMessage({
    address: owner,
    chainId: 50383,
    domain: 'perps.test',
    uri: origin,
    version: '1',
    nonce: '1234567890abcdef',
    requestId: id,
    issuedAt: new Date(now),
    expirationTime: new Date(now + 300000),
    statement: 'Sign in to PerpsHQ Agent Studio. This does not authorize transactions.',
    ...overrides,
  });
}
it('allows only the current wallet/domain/chain and fresh explicit sign-in statement', () => {
  expect(() => assertWalletChallenge(message(), owner, origin, id, now)).not.toThrow();
});
it.each([
  { domain: 'attacker.test' },
  { chainId: 1 },
  { address: '0x2222222222222222222222222222222222222222' },
  { statement: 'Authorize something else' },
  { expirationTime: new Date(now - 1) },
  { issuedAt: new Date(now + 60000) },
])('refuses a substituted or expired wallet message: %j', (overrides) => {
  expect(() => assertWalletChallenge(message(overrides), owner, origin, id, now)).toThrow(
    'challenge',
  );
});
