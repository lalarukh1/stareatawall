const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

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

  if (req.method === 'POST') {
    const { id, text, name } = req.body;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    await redis(['HSET', 'wall:notes', id, JSON.stringify({
      text: text.slice(0, 200),
      name: (name || '').slice(0, 50),
      created_at: new Date().toISOString(),
    })]);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'method not allowed' });
}
