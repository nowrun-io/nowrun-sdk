// Drape command channel — the pipe that lets a real agent (custom GPT action,
// Ashish's send_to_app MCP tool, curl) drive the app remotely.
//
//   POST {command: {...}}  header x-drape-key   -> {id}        queue a command
//   GET  ?after=<id>                            -> {commands}  app polls this
//   GET  ?state=1                               -> {state}     agent reads app state
//   POST {state: {...}}    (from the app)       -> {ok}        app publishes its state
//
// Queue + latest-state live in Upstash Redis (REST API, env-provisioned by the
// Vercel marketplace integration). Commands expire after 10 minutes.

const QUEUE_KEY = 'drape:commands';
const STATE_KEY = 'drape:state';
const MAX_QUEUE = 40;

function redisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(cmds) {
  const env = redisEnv();
  if (!env) throw new Error('redis not configured');
  const res = await fetch(`${env.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-drape-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const q = new URL(req.url, 'http://x').searchParams;

    if (req.method === 'POST') {
      const body = req.body || {};

      // The app publishing its state (no key needed — it's the app's own data)
      if (body.state) {
        await redis([['SET', STATE_KEY, JSON.stringify(body.state)], ['EXPIRE', STATE_KEY, 3600]]);
        return res.status(200).json({ ok: true });
      }

      // An agent queueing a command — guarded by the shared key
      if (process.env.DRAPE_COMMAND_KEY && req.headers['x-drape-key'] !== process.env.DRAPE_COMMAND_KEY) {
        return res.status(401).json({ error: 'bad key' });
      }
      const command = body.command;
      if (!command || typeof command.tool !== 'string') {
        return res.status(400).json({ error: 'body must be {command: {tool, ...}}' });
      }
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, command, ts: Date.now() };
      await redis([
        ['RPUSH', QUEUE_KEY, JSON.stringify(entry)],
        ['LTRIM', QUEUE_KEY, -MAX_QUEUE, -1],
        ['EXPIRE', QUEUE_KEY, 600],
      ]);
      return res.status(200).json({ id: entry.id, queued: true });
    }

    if (req.method === 'GET') {
      // Agent reading the app's last-published state
      if (q.get('state')) {
        const out = await redis([['GET', STATE_KEY]]);
        const raw = out?.[0]?.result;
        return res.status(200).json({ state: raw ? JSON.parse(raw) : null });
      }
      // The app polling for commands newer than its cursor
      const after = q.get('after') || '';
      const out = await redis([['LRANGE', QUEUE_KEY, 0, -1]]);
      const all = (out?.[0]?.result || []).map((s) => JSON.parse(s));
      const fresh = after ? all.filter((e) => e.id > after) : all.slice(-5);
      return res.status(200).json({ commands: fresh, cursor: all.length ? all[all.length - 1].id : after });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
};
