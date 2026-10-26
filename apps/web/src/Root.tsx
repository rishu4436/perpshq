import { lazy, Suspense, useEffect, useState } from 'react';
import Landing from './Landing';
import { StorageRecoveryNotice, WorkspaceBoundary } from './components/workspace-boundary';
import { saveStored } from './storage';
const Workspace = lazy(() => import('./App'));
export default function Root() {
  const isApp = location.pathname.startsWith('/app');
  const [ready, setReady] = useState(!isApp || !new URLSearchParams(location.search).has('market'));
  useEffect(() => {
    if (!isApp) return;
    const id = new URLSearchParams(location.search).get('market');
    if (id && /^0x[0-9a-fA-F]{40}$/.test(id)) saveStored(localStorage, 'perpshq.market', id, '');
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
        <WorkspaceBoundary>
          <StorageRecoveryNotice />
          <Workspace />
        </WorkspaceBoundary>
      </Suspense>
    ) : (
      loading
    )
  ) : (
    <Landing />
  );
}
