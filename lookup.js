// lookup.js - Radar Lookup core. Pure functions exported for tests; DOM wiring lives in lookup.html.
export const QUEUE_ENDPOINT = ''; // paste Google Apps Script /exec URL here when deployed (see queue/SETUP.md)

export function parseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const url = s.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (url) return { mode: 'url', owner: url[1], repo: url[2].replace(/\.git$/, '') };
  if (!s.includes(' ')) {
    const short = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (short) return { mode: 'url', owner: short[1], repo: short[2].replace(/\.git$/, '') };
  }
  return { mode: 'search', query: s };
}

export function formatCount(n) {
  if (n == null) return '?';
  if (n >= 10000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function queueKey() { return 'rr_lookup_queue'; }

export function readQueue(storage) {
  try { return JSON.parse(storage.getItem(queueKey())) || []; } catch { return []; }
}

export function addToQueue(storage, item) {
  const q = readQueue(storage);
  const norm = (x) => (x.type + ':' + x.query).toLowerCase();
  if (!q.some((x) => norm(x) === norm(item))) q.push(item);
  storage.setItem(queueKey(), JSON.stringify(q));
  return q;
}

export async function postToQueue(item) {
  if (!QUEUE_ENDPOINT) return { sent: false };
  try {
    await fetch(QUEUE_ENDPOINT, { method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(item) });
    return { sent: true };
  } catch { return { sent: false }; }
}
