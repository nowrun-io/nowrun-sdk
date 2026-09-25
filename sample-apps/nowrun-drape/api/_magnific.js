// Shared Magnific MCP-over-HTTP helpers for the Drape API routes.
// Underscore prefix keeps this file out of Vercel's route table.

const MCP_URL = 'https://mcp.magnific.com';
const FOLDER = 'cacc1709-eea8-45fa-9ddb-b487c177e7c9'; // drape-assets project
const TOKEN_URL = 'https://auth.magnific.com/realms/mcp/protocol/openid-connect/token';
const DEFAULT_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

// Access tokens live 3 days, which is why this endpoint kept dying. The OAuth
// refresh token is an "Offline" grant: it never expires, and Keycloak's
// rotation is non-destructive (a reused refresh token is still accepted), so a
// static MAGNIFIC_REFRESH_TOKEN can safely mint tokens from every lambda.
// Cached in module scope, so warm invocations reuse one token.
let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  const refresh = process.env.MAGNIFIC_REFRESH_TOKEN;
  if (!refresh) {
    // Legacy path: a hand-pasted 3-day token. Works, but expires.
    const legacy = process.env.MAGNIFIC_ACCESS_TOKEN;
    if (!legacy) throw new Error('neither MAGNIFIC_REFRESH_TOKEN nor MAGNIFIC_ACCESS_TOKEN is configured');
    return legacy;
  }
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: process.env.MAGNIFIC_CLIENT_ID || DEFAULT_CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`magnific token refresh failed (${res.status}): ${text.slice(0, 200)} - MAGNIFIC_REFRESH_TOKEN may have been revoked`);
  }
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('magnific token refresh returned no access_token');
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

async function rpc(method, params, { session, token, id = 1, notify = false } = {}) {
  const msg = { jsonrpc: '2.0', method };
  if (!notify) msg.id = id;
  if (params) msg.params = params;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(msg) });
  const newSession = res.headers.get('mcp-session-id') || session;
  const text = await res.text();
  if (!res.ok) {
    // Magnific returns 401 {"message":"Unauthenticated."} on an expired/invalid
    // token. Surface it here - otherwise it walks through as a missing .result
    // and gets reported as "unparseable MCP result", which sends you hunting an
    // API-shape change that isn't there.
    let detail = text.slice(0, 200);
    try { detail = JSON.parse(text).message || JSON.parse(text).error || detail; } catch {}
    if (res.status === 401 || res.status === 403) {
      throw new Error(`magnific auth failed (${res.status}): ${detail} - MAGNIFIC_ACCESS_TOKEN is expired or invalid`);
    }
    throw new Error(`magnific HTTP ${res.status}: ${detail}`);
  }
  if (notify || !text) return { data: null, session: newSession };
  let data;
  if (text.startsWith('event:') || text.includes('\ndata:') || text.startsWith('data:')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    if (!line) throw new Error(`magnific: no data line in SSE response: ${text.slice(0, 200)}`);
    data = JSON.parse(line.slice(5));
  } else {
    data = JSON.parse(text);
  }
  return { data, session: newSession };
}

function payload(data) {
  const res = (data || {}).result || {};
  if (res.isError) {
    const texts = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    throw new Error(`magnific: ${texts.join(' | ').slice(0, 300)}`);
  }
  if (res.structuredContent) return res.structuredContent;
  for (const c of res.content || []) {
    if (c.type === 'text') {
      try { return JSON.parse(c.text); } catch {}
    }
  }
  throw new Error('unparseable MCP result');
}

async function openSession(token) {
  const { data, session } = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'drape-api', version: '1.0' },
  }, { token });
  // Magnific reports failures as `message`, not the JSON-RPC `error` field.
  if (data && (data.error || data.message)) {
    throw new Error(`magnific initialize failed: ${JSON.stringify(data.error || data.message)}`);
  }
  if (!session) throw new Error('magnific initialize returned no Mcp-Session-Id');
  await rpc('notifications/initialized', {}, { token, session, notify: true });
  return session;
}

async function callTool(name, args, { token, session, id = 5 }) {
  const { data } = await rpc('tools/call', { name, arguments: args }, { token, session, id });
  return payload(data);
}

module.exports = { MCP_URL, FOLDER, rpc, payload, openSession, callTool, accessToken };
