import { lazy, Suspense, useEffect, useState } from 'react';
import Landing from './Landing';
const Workspace = lazy(() => import('./App'));
export default function Root() {
  const isApp = location.pathname.startsWith('/app');
  const [ready, setReady] = useState(!isApp || !new URLSearchParams(location.search).has('market'));
  useEffect(() => {
    if (!isApp) return;
    const id = new URLSearchParams(location.search).get('market');
    if (id && /^0x[0-9a-fA-F]{40}$/.test(id))
      localStorage.setItem('perpshq.market', JSON.stringify(id));
    setReady(true);
  }, [isApp]);
  const loading = (
    <div className="workspace-loading">
      <span />
      <p>Opening your workspace.</p>
    </div>
  );
  return isApp ? (
    ready ? (
      <Suspense fallback={loading}>
        <Workspace />
      </Suspense>
    ) : (
      loading
    )
  ) : (
    <Landing />
  );
}
