// Phone verification via Twilio Verify — powers the "7-day Pro trial, once per
// phone number" offer. Activates only when the three TWILIO_* vars are set.
//
// We never store raw phone numbers: we hash them and only remember the hash, so
// "once per number" is enforced without holding personal data.

import { createHash } from 'node:crypto';

export function verifyConfigured(env) {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
}

// Best-effort E.164 normalisation, UK-defaulted (this is a UK-first product).
export function normalizePhone(raw, defaultCc = '44') {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+' + defaultCc + s.slice(1);   // 07... -> +447...
  if (s.startsWith(defaultCc)) return '+' + s;
  return '+' + s;
}
export function phoneHash(e164) { return createHash('sha256').update(e164).digest('hex'); }

function twBase(env) { return env.TWILIO_BASE || 'https://verify.twilio.com'; }
function authHeader(env) {
  return 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
}

export async function sendCode(env, e164) {
  const url = `${twBase(env)}/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: e164, Channel: 'sms' }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Twilio send failed (${res.status}): ${t.slice(0, 140)}`); }
  return res.json();
}

export async function checkCode(env, e164, code) {
  const url = `${twBase(env)}/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: e164, Code: String(code) }),
  });
  if (!res.ok) return { approved: false };
  const j = await res.json();
  return { approved: j.status === 'approved' };
}
