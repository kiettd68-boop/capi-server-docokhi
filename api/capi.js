// api/capi.js (Vercel serverless)
import crypto from 'crypto';

const DEFAULT_PIXEL_ID = process.env.PIXEL_ID || '1340570021110699';
const PIXEL_TOKENS_RAW = process.env.PIXEL_TOKENS || '{}';
const CAPI_SECRET_EXPECTED = process.env.CAPI_SECRET || ''; // để rỗng nếu ko muốn kiểm tra header

function sha256Lowercase(input = '') {
  return crypto.createHash('sha256').update(String(input).trim().toLowerCase()).digest('hex');
}

function getAccessTokenForPixel(pixelId) {
  try {
    const parsed = JSON.parse(PIXEL_TOKENS_RAW);
    if (parsed && parsed[pixelId]) return parsed[pixelId];
  } catch (e) {
    // fallback: hỗ trợ "PIXELID|TOKEN" hoặc "PIXELID,TOKEN" hoặc token trực tiếp
    if (PIXEL_TOKENS_RAW.includes('|') || PIXEL_TOKENS_RAW.includes(',')) {
      const sep = PIXEL_TOKENS_RAW.includes('|') ? '|' : ',';
      const parts = PIXEL_TOKENS_RAW.split(sep).map(s => s.trim());
      if (parts[0] === pixelId && parts[1]) return parts[1];
    }
    // nếu PIXEL_TOKENS_RAW là token đơn và pixelId là DEFAULT_PIXEL_ID
    if (!PIXEL_TOKENS_RAW.startsWith('{') && PIXEL_TOKENS_RAW.length > 10) return PIXEL_TOKENS_RAW;
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional: validate secret
  //const incomingSecret = req.headers['x-capi-secret'] || '';
  //if (CAPI_SECRET_EXPECTED && incomingSecret !== CAPI_SECRET_EXPECTED) {
    //return res.status(401).json({ ok: false, error: 'Invalid x-capi-secret' });
  }

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
      return res.status(500).json({ ok: false, error: 'Missing access token for pixel. Check PIXEL_TOKENS env.' });
    }

    // Hash user_data per Facebook (sha256 lowercase)
    const ud = {};
    if (user_data.email) ud.em = sha256Lowercase(user_data.email);
    if (user_data.phone) {
      const phoneNormalized = String(user_data.phone).replace(/\D/g, '');
      if (phoneNormalized) ud.ph = sha256Lowercase(phoneNormalized);
    }
    if (user_data.client_ip_address) ud.client_ip_address = user_data.client_ip_address;
    if (user_data.client_user_agent) ud.client_user_agent = user_data.client_user_agent;

    const eventTime = Math.floor(Date.now() / 1000);

    // custom_data: theo yêu cầu anh, KHÔNG gửi value/ROAS; chỉ gửi content_ids/currency nếu có
    const custom_data = {};
    if (currency) custom_data.currency = currency;
    if (content_ids && content_ids.length) custom_data.content_ids = content_ids;
    if (order_id && !custom_data.content_ids) custom_data.content_ids = [order_id];
    custom_data.content_type = 'product';

    const payload = {
      data: [
        {
          event_name,
          event_time: eventTime,
          event_id: event_id || crypto.randomUUID(),
          event_source_url: event_source_url || (req.headers.referer || null),
          user_data: Object.keys(ud).length ? ud : undefined,
          custom_data
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

    if (!fbRes.ok) {
      console.error('Facebook CAPI error', fbJson);
      return res.status(502).json({ ok: false, fb_error: fbJson });
    }

    return res.status(200).json({ ok: true, fb: fbJson });
  } catch (err) {
    console.error('CAPI handler error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
