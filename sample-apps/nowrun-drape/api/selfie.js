// Drape "dress me" — upload the user's photo as a Magnific creation so
// /api/visualize can use it as the identity reference.
// POST {imageBase64, mime} -> {identityId}
// Client compresses to ~1MB; Vercel's request cap is 4.5MB.

const { FOLDER, openSession, callTool, accessToken } = require('./_magnific');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });


  try {
    const { imageBase64, mime = 'image/jpeg' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'missing imageBase64' });
    const bytes = Buffer.from(imageBase64, 'base64');
    if (bytes.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'image too large' });

    const token = await accessToken();
    const session = await openSession(token);

    // Step 1: presigned upload slot
    const up = await callTool('creations_request_upload', { mimeType: mime }, { token, session, id: 6 });
    const slot = (up.uploads && up.uploads[0]) || up;
    const putUrl = slot.proxyUploadUrl || slot.url || slot.uploadUrl;
    if (!putUrl) throw new Error(`unexpected upload slot: ${JSON.stringify(up).slice(0, 300)}`);
    const path = slot.path || new URL(putUrl).searchParams.get('path');
    if (!path) throw new Error('no path in upload slot');

    // Step 2: PUT the bytes
    const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
    if (!put.ok) throw new Error(`upload PUT failed: ${put.status}`);

    // Step 3: finalize as a hidden working asset
    const fin = await callTool(
      'creations_finalize_upload',
      { path, visible: false, folderReference: FOLDER },
      { token, session, id: 7 },
    );
    const creation = (fin.creations && fin.creations[0]) || fin;
    const identityId = creation.identifier;
    if (!identityId) throw new Error(`no identifier from finalize: ${JSON.stringify(fin).slice(0, 300)}`);

    return res.status(200).json({ identityId });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
