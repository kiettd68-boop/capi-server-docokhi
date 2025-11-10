// api/capi.js — replace whole file with this
import crypto from 'crypto';

const DEFAULT_PIXEL_ID = process.env.PIXEL_ID || '1340570021110699';
const PIXEL_TOKENS_RAW = process.env.PIXEL_TOKENS || '{}';

function sha256Lowercase(s=''){ return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex'); }
function getAccessTokenForPixel(id){
  try { const p = JSON.parse(PIXEL_TOKENS_RAW); if(p && p[id]) return p[id]; }
  catch(e){}
  // fallback if PIXEL_TOKENS is raw token
  if(PIXEL_TOKENS_RAW && !PIXEL_TOKENS_RAW.trim().startsWith('{')) return PIXEL_TOKENS_RAW;
  return '';
}
function setCors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,x-capi-secret'); }

export default async function handler(req,res){
  setCors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const rawBody = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const body = rawBody || {};
    // normalize inputs
    const event_name = body.event_name || 'Purchase';
    const event_id = body.event_id || crypto.randomUUID();
    const order_id = body.order_id || null;
    const currency = body.currency || 'VND';
    const content_ids = body.content_ids || (order_id ? [order_id] : undefined);
    const event_source_url = body.event_source_url || req.headers.referer || null;

    // user data hash
    const ud = {};
    if(body.user_data && body.user_data.email) ud.em = sha256Lowercase(body.user_data.email);
    if(body.user_data && body.user_data.phone){
      const ph = String(body.user_data.phone).replace(/\D/g,'');
      if(ph) ud.ph = sha256Lowercase(ph);
    }
    if(body.user_data && body.user_data.client_user_agent) ud.client_user_agent = body.user_data.client_user_agent;

    // FORCE value parsing (number). Accept number or string like "699k" or "399.000"
    let valueToSend = null;
    if(typeof body.value === 'number' && !isNaN(body.value)) valueToSend = Number(body.value);
    else if(typeof body.value === 'string'){
      let s = body.value.trim().toLowerCase();
      const mK = s.match(/([0-9\.,]+)\s*k\b/);
      if(mK && mK[1]) { valueToSend = Math.round(Number(mK[1].replace(/[.,]/g,'')) * 1000); }
      else { const only = s.replace(/[^0-9.\-]/g,''); const p = Number(only); if(!isNaN(p) && p!==0) valueToSend = p; }
    }
    if(valueToSend === null) {
      // fallback to 1 so FB accepts Purchase event (but ideally client should send real value)
      valueToSend = 1;
    }

    const PIXEL_ID = DEFAULT_PIXEL_ID;
    const ACCESS_TOKEN = getAccessTokenForPixel(PIXEL_ID);
    if(!ACCESS_TOKEN) return res.status(500).json({ ok:false, error:'Missing ACCESS_TOKEN in PIXEL_TOKENS' });

    const payload = {
      data: [{
        event_name,
        event_time: Math.floor(Date.now()/1000),
        event_id,
        event_source_url,
        user_data: Object.keys(ud).length ? ud : undefined,
        custom_data: {
          value: valueToSend,
          currency,
          content_type: 'product',
          content_ids: content_ids
        }
      }]
    };

    // log payload to Vercel logs for debugging
    console.log('CAPI -> payload', JSON.stringify(payload));

    const url = `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const fbRes = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const fbJson = await fbRes.json();

    console.log('CAPI -> fbRes status', fbRes.status, 'fbJson', JSON.stringify(fbJson));
    setCors(res);
    return res.status(fbRes.ok ? 200 : 502).json({ ok: fbRes.ok, fb: fbJson });
  } catch(err){
    console.error('CAPI handler error', err);
    setCors(res);
    return res.status(500).json({ ok:false, error: String(err && err.message ? err.message : err) });
  }
}
