import { Component, useEffect, useState, type ReactNode } from 'react';
import { download } from '../lib';
import { exportBrowserStorage, storageNotices } from '../storage';
export function StorageRecoveryNotice() {
  const [messages, setMessages] = useState(storageNotices);
  useEffect(() => {
    const update = () => setMessages(storageNotices());
    window.addEventListener('perpshq-storage-notice', update);
    update();
    return () => window.removeEventListener('perpshq-storage-notice', update);
  }, []);
  if (!messages.length) return null;
  return (
    <aside className="notice storage-recovery" role="status">
      <strong>Workspace storage recovery</strong>
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
      <button
        className="secondary"
        onClick={() =>
          download(
            'perpshq-recovered-storage.json',
            JSON.stringify(exportBrowserStorage(localStorage), null, 2),
          )
        }
      >
        Export preserved data
      </button>
    </aside>
  );
}
export class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        className="workspace-recovery panel"
        style={{ maxWidth: 720, margin: '10vh auto', padding: 32 }}
      >
        <h1>Your workspace needs recovery</h1>
        <p>The screen could not load. Your saved data has not been cleared.</p>
        <button
          className="primary"
          onClick={() => {
            location.hash = '';
            location.pathname = '/app';
            location.reload();
          }}
        >
          Reopen Command Center
        </button>
        <button
          className="secondary"
          onClick={() => {
            download(
              'perpshq-recovery-export.json',
              JSON.stringify(exportBrowserStorage(localStorage), null, 2),
            );
          }}
        >
          Export saved workspace data
        </button>
      </main>
    );
  }
}
