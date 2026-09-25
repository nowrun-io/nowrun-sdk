// Drape ✨ Visualize — Vercel serverless function.
// POST {skuIds: ["top_01", ...]}  -> {id}            (starts the try-on render)
// GET  ?id=<creationId>           -> {status, url?}  (poll until completed)
//
// Talks to Magnific's MCP endpoint over plain JSON-RPC. Auth = MAGNIFIC_REFRESH_TOKEN
// (a non-expiring OAuth offline token); _magnific.js mints a short-lived access
// token per cold start. Keeps credentials server-side — the app never sees them.

const { openSession, rpc, payload, FOLDER, accessToken } = require('./_magnific');
const MAP = require('./creations-map.json');

const NAMES = {
  top_01: 'relaxed white oxford shirt', top_02a: 'boxy navy t-shirt', top_02b: 'boxy ecru t-shirt',
  top_02c: 'boxy olive t-shirt', top_03: 'collarless cream linen shirt', top_04: 'black merino turtleneck',
  top_05: 'muted sage sateen shirt', top_06: 'chestnut flannel overshirt',
  bot_01a: 'dark indigo straight-leg jeans', bot_01b: 'pale washed straight-leg jeans',
  bot_02: 'charcoal wide-leg wool trousers', bot_03: 'warm beige cotton chinos',
  bot_04: 'caramel knife-pleated midi skirt', bot_05: 'muted sage drawstring shorts',
  drs_01: 'dusty-rose A-line midi dress', drs_02: 'black bias-cut slip dress',
  out_01: 'camel double-breasted wool overcoat worn open', out_02: 'matte black hooded rain shell',
  out_03: 'mid-blue washed denim jacket', out_04: 'sand belted trench coat',
  out_05: 'warm taupe padded bomber jacket',
  sho_01: 'minimal white leather court sneakers', sho_02: 'polished black leather derby shoes',
  sho_03: 'tan suede loafers', sho_04: 'black leather chelsea boots',
  acc_01: 'natural canvas tote bag carried in hand', acc_02: 'minimal steel wristwatch on the wrist',
  acc_03: 'terracotta wool scarf draped loosely around the neck', acc_04: 'compact navy umbrella held in hand',
  acc_05: 'muted forest-green six-panel cap worn on the head',
  // Coast
  cst_01: 'pale sand linen camp-collar shirt worn open-collared', cst_02: 'oatmeal terry-cloth polo',
  cst_03: 'ecru crochet knit tank', cst_04: 'sea-teal swim shorts', cst_05: 'off-white wide-leg linen trousers',
  cst_06: 'terracotta sarong wrap tied at the waist', cst_07: 'tan leather slide sandals',
  cst_08: 'woven straw tote carried in hand', cst_09: 'off-white cotton bucket hat worn on the head',
  cst_10: 'dark tortoiseshell sunglasses worn on the face',
  // Alpine
  alp_01: 'stone-grey fleece half-zip', alp_02: 'dark taupe merino base layer',
  alp_03: 'walnut waffle-knit sweater', alp_04: 'olive-grey technical cargo pants',
  alp_05: 'graphite waterproof shell trousers', alp_06: 'forest-green down puffer jacket worn zipped',
  alp_07: 'sandstone softshell parka worn open', alp_08: 'brown leather hiking boots',
  alp_09: 'sage-grey trail running shoes', alp_10: 'rust-brown ribbed wool beanie worn on the head',
  alp_11: 'charcoal insulated gloves worn on the hands',
  // Festive
  fst_01a: 'ivory straight-cut kurta with band collar', fst_01b: 'deep teal straight-cut kurta with band collar',
  fst_02: 'deep maroon silk festive kurta with tonal embroidery', fst_03: 'antique-gold brocade waistcoat worn over the kurta',
  fst_04: 'midnight-indigo bandhgala jacket with mandarin collar', fst_05: 'walnut Nehru jacket worn over the kurta',
  fst_06: 'ivory draped dhoti pants', fst_07: 'off-white churidar trousers with gathered ankles',
  fst_08: 'deep red embroidered silk stole with gold border draped over the shoulder',
  fst_09a: 'tan embroidered leather juttis', fst_09b: 'ivory embroidered juttis',
  fst_10: 'tan Kolhapuri leather sandals',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();


  try {
    const token = await accessToken();
    const session = await openSession(token);

    if (req.method === 'POST') {
      const { skuIds, identityId } = req.body || {};
      if (!Array.isArray(skuIds) || skuIds.length === 0 || skuIds.length > 10) {
        return res.status(400).json({ error: 'skuIds must be a non-empty array (max 10)' });
      }
      const unknown = skuIds.filter((s) => !MAP[s]);
      if (unknown.length) return res.status(400).json({ error: `unknown skuIds: ${unknown.join(',')}` });

      const identity = identityId || MAP.__avatar__;
      const references = [
        { type: 'image', identifier: identity },
        ...skuIds.map((s) => ({ type: 'image', identifier: MAP[s] })),
      ];
      const garments = skuIds.map((s) => `the ${NAMES[s] || s}`).join(', ');
      const prompt =
        'Full-body studio fashion photograph of the exact person from the first reference image, same face, ' +
        `same hair, same body, now dressed in the exact garments from the other reference images: ${garments}. ` +
        "Preserve each garment's exact colour, fabric and details from its reference photo. Natural relaxed " +
        'standing pose facing the camera, full figure head to feet. Same seamless warm light-grey studio ' +
        'background and soft even diffused lighting as the references. Premium minimalist fashion editorial. ' +
        'No text, no logos.' +
        (identityId
          ? ' Preserve the person from the first reference photo exactly: same face, same hair, same body and skin tone.'
          : '');

      const { data } = await rpc('tools/call', {
        name: 'images_generate',
        arguments: { prompt, aspectRatio: '2:3', count: 1, references, folderReference: FOLDER },
      }, { token, session, id: 8 });
      const out = payload(data);
      const creation = (out.creations || [])[0];
      if (!creation) throw new Error('no creation started');
      return res.status(200).json({ id: creation.identifier, expectTime: creation.expectTime || 40 });
    }

    if (req.method === 'GET') {
      const id = (req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { data } = await rpc('tools/call', {
        name: 'creations_wait',
        arguments: { identifiers: [id], timeoutSeconds: 8 },
      }, { token, session, id: 9 });
      const out = payload(data);
      const entry = ((out.results || out.creations) || [])[0] || {};
      const status = entry.status || 'unknown';
      if (status === 'completed') {
        const results = entry.results || {};
        return res.status(200).json({ status, url: results.url || results.thumbnailUrl });
      }
      if (status === 'failed' || status === 'error') return res.status(200).json({ status: 'failed' });
      return res.status(200).json({ status: 'processing' });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
};
