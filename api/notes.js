const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  return data.result;
}

async function getRateKey(ip) {
  const key = `rate:${ip}`;
  const count = await redis(['INCR', key]);
  if (count === 1) await redis(['EXPIRE', key, 60]); // 1 minute window
  return count;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://stareatawall.org');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — return all notes
  if (req.method === 'GET') {
    const raw = await redis(['HGETALL', 'wall:notes']);
    if (!raw || raw.length === 0) return res.json([]);
    const notes = [];
    for (let i = 0; i < raw.length; i += 2) {
      try {
        notes.push({ id: raw[i], ...JSON.parse(raw[i + 1]) });
      } catch {}
    }
    notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return res.json(notes);
  }

  // POST — add or update a note
  if (req.method === 'POST') {
    // rate limit: max 5 requests per minute per IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const count = await getRateKey(ip);
    if (count > 5) return res.status(429).json({ error: 'too many requests' });

    const { id, text, name } = req.body || {};

    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });

    await redis(['HSET', 'wall:notes', id, JSON.stringify({
      text: escapeHtml(text.trim().slice(0, 200)),
      name: escapeHtml((name || '').trim().slice(0, 50)),
      created_at: new Date().toISOString(),
    })]);
    return res.json({ ok: true });
  }

  // DELETE — admin only, remove a note by id
  if (req.method === 'DELETE') {
    if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'unauthorised' });
    }
    const { id } = req.body || {};
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid id' });
    await redis(['HDEL', 'wall:notes', id]);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
}
