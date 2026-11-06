import { useEffect, useState } from 'react';

/** Phase 0 smoke page: proves the client → Vite proxy → API → Atlas path works. */
export default function App() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/healthz', { signal: ctrl.signal })
      .then(async (res) => setHealth({ state: res.ok ? 'ok' : 'down', body: await res.json() }))
      .catch((err) => { if (err.name !== 'AbortError') setHealth({ state: 'error', error: err.message }); });
    return () => ctrl.abort();
  }, []);

  return (
    <main className="shell">
      <h1>SyncBoard</h1>
      <p className={`health health--${health.state}`}>
        healthz: <strong>{health.state}</strong>
        {health.body?.db && <> · db {health.body.db} · {health.body.instance}</>}
        {health.error && <> · {health.error}</>}
      </p>
    </main>
  );
}
