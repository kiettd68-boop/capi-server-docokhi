// api/capi.js (Vercel serverless) - stable debug version
import crypto from 'crypto';

const DEFAULT_PIXEL_ID = process.env.PIXEL_ID || '1340570021110699';
const PIXEL_TOKENS_RAW = process.env.PIXEL_TOKENS || '{}';

function sha256Lowercase(input = '') {
  return crypto.createHash('sha256').update(String(input).trim().toLowerCase()).digest('hex');
}

function getAccessTokenForPixel(pixelId) {
  try {
    const parsed = JSON.parse(PIXEL_TOKENS_RAW);
    if (parsed && parsed[pixelId]) return parsed[pixelId];
  } catch (e) {
    console.error('PIXEL_TOKENS parse error:', e);
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const {
      event_name = 'Purchase',
      event_id,
      order_id,
      currency = 'VND',
      content_ids,
      user_data = {},
      event_source_url
    } = body;

    const PIXEL_ID = DEFAULT_PIXEL_ID;
    const ACCESS_TOKEN = getAccessTokenForPixel(PIXEL_ID);

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Missing access token or bad PIXEL_TOKENS' });
    }

    const ud = {};
    if (user_data.email) ud.em = sha256Lowercase(user_data.email);
    if (user_data.phone) {
      const ph = String(user_data.phone).replace(/\D/g, '');
      if (ph) ud.ph = sha256Lowercase(ph);
    }
    if (user_data.client_user_agent) ud.client_user_agent = user_data.client_user_agent;

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: event_id || crypto.randomUUID(),
          event_source_url: event_source_url || null,
          user_data: ud,
          custom_data: {
            currency,
            content_type: 'product',
            content_ids: content_ids || (order_id ? [order_id] : undefined)
          }
        }
      ]
    };

    const url = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const fbRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const fbJson = await fbRes.json();

    return res.status(fbRes.ok ? 200 : 502).json({ ok: fbRes.ok, fb: fbJson });
  } catch (err) {
    console.error('CAPI handler error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
