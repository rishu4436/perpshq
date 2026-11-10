import type { Provider } from './transaction';
/** Discover the requested MetaMask provider independently of competing legacy injection. */
export function discoverWalletProvider(
  target: EventTarget,
  legacy: Provider | undefined,
  changed: (provider: Provider | undefined) => void,
) {
  let selected = legacy,
    metamaskSelected = false;
  changed(selected);
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (
      !detail ||
      typeof detail.provider?.request !== 'function' ||
      typeof detail.info?.rdns !== 'string'
    )
      return;
    if (detail.info.rdns === 'io.metamask' && !metamaskSelected) {
      metamaskSelected = true;
      selected = detail.provider;
      changed(selected);
    } else if (!selected) {
      selected = detail.provider;
      changed(selected);
    }
  };
  target.addEventListener('eip6963:announceProvider', announce);
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => target.removeEventListener('eip6963:announceProvider', announce);
}
