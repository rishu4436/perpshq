import { parseSiweMessage } from 'viem/siwe';
export function assertWalletChallenge(
  message: string,
  account: string,
  origin: string,
  id: string,
  now = Date.now(),
) {
  const parsed = parseSiweMessage(message),
    url = new URL(origin);
  if (
    parsed.domain !== url.host ||
    parsed.uri !== url.origin ||
    parsed.chainId !== 50383 ||
    parsed.version !== '1' ||
    parsed.address?.toLowerCase() !== account.toLowerCase() ||
    parsed.requestId !== id ||
    parsed.statement !== 'Sign in to PerpsHQ Agent Studio. This does not authorize transactions.' ||
    !parsed.nonce ||
    !/^[a-zA-Z0-9]{16,}$/.test(parsed.nonce) ||
    !parsed.issuedAt ||
    !parsed.expirationTime ||
    parsed.issuedAt.getTime() > now + 5000 ||
    parsed.issuedAt.getTime() < now - 300000 ||
    parsed.expirationTime.getTime() <= now ||
    parsed.expirationTime.getTime() > now + 310000
  )
    throw new Error(
      'Sign-in challenge does not match this wallet and website, or has expired. Request a new sign-in.',
    );
}
