import { readFileSync } from 'node:fs';

const DAY = 86_400_000;
const CONSENT_VERSION = 'beta-waitlist-1';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DEVICES = new Set(['iphone', 'android', 'both']);
const ROLES = new Set(['', 'cosplayer', 'photographer', 'maker', 'organizer', 'other']);
const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** A separate public entry point: no app account or signed-in session is required. */
export function serveBetaPage(req, res, pathname) {
  const files = {
    '/beta': ['index.html', 'text/html; charset=utf-8'],
    '/beta/': ['index.html', 'text/html; charset=utf-8'],
    '/beta/assets/beta.css': ['beta.css', 'text/css; charset=utf-8'],
    '/beta/assets/beta.js': ['beta.js', 'text/javascript; charset=utf-8'],
  };
  if (!['GET', 'HEAD'].includes(req.method) || !Object.hasOwn(files, pathname)) return false;
  const [file, contentType] = files[pathname];
  const content = readFileSync(new URL(`./beta/${file}`, import.meta.url));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}

export function createBeta({ db, get, all, run, transaction, id, now, digest, secret, fail, string, send, body, limited,
  appOrigin, mailSender, supportEmail = '', minimumAge = 18, production = false, logger = console, dailyEmailLimit = 50 }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS beta_subscribers (
      email TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('pending','confirmed')),
      device TEXT NOT NULL, updatesConsent INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT '', nextShoot TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '{}',
      ageConfirmedAt INTEGER NOT NULL, confirmedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
      consentVersion TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS beta_requests (
      id TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES beta_subscribers(email) ON DELETE CASCADE,
      receiptHash TEXT UNIQUE, confirmHash TEXT UNIQUE, manageHash TEXT UNIQUE, manageExpiresAt INTEGER,
      device TEXT NOT NULL, updatesConsent INTEGER NOT NULL, role TEXT NOT NULL DEFAULT '', nextShoot TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL, requestedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, confirmedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS beta_requests_email ON beta_requests(email);
    CREATE TABLE IF NOT EXISTS beta_unsubscribe_tokens (
      tokenHash TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES beta_subscribers(email) ON DELETE CASCADE, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS beta_email_limits (key TEXT PRIMARY KEY, windowStart INTEGER NOT NULL, count INTEGER NOT NULL, lastSentAt INTEGER NOT NULL);
  `);
  let origin;
  try {
    const parsed = new URL(appOrigin);
    if (parsed.origin === appOrigin && (production ? parsed.protocol === 'https:' : ['http:', 'https:'].includes(parsed.protocol))) origin = parsed.origin;
  } catch { /* No configured origin: keep signup unavailable. */ }
  const available = Boolean(origin && typeof mailSender === 'function');
  const age = Math.max(18, minimumAge);

  function cleanup() {
    transaction(() => {
      run(`DELETE FROM beta_subscribers WHERE ((state=? AND updatedAt<=?) OR (state=? AND confirmedAt<=?))
        AND NOT EXISTS(SELECT 1 FROM beta_requests r WHERE r.email=beta_subscribers.email AND r.confirmedAt IS NULL AND r.expiresAt>?)`,
        'pending', now() - 7 * DAY, 'confirmed', now() - 180 * DAY, now());
      run('DELETE FROM beta_requests WHERE expiresAt<=?', now());
      run('DELETE FROM beta_email_limits WHERE windowStart<=?', now() - DAY);
    });
  }
  cleanup();
  const cleanupTimer = setInterval(() => { try { cleanup(); } catch { logger.warn?.('Beta request retention cleanup will retry.'); } }, 60 * 60_000);
  cleanupTimer.unref();

  function checkToken(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) fail(400, 'This link is invalid or expired. Request a new confirmation from the beta page.');
    return digest(token);
  }
  function details(data) {
    const role = string(data.role, 'role', { max: 30 });
    if (!ROLES.has(role)) fail(400, 'Choose one of the listed roles.');
    return { role, nextShoot: string(data.nextShoot, 'next shoot', { max: 300 }) };
  }
  function source(data) {
    if (data === undefined) return '{}';
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Invalid campaign source.');
    return JSON.stringify(Object.fromEntries(SOURCE_KEYS.filter(key => data[key] !== undefined).map(key => [key, string(data[key], 'campaign source', { max: 120 }).replace(/[\x00-\x1f\x7f]/g, '')])));
  }
  function reserveDelivery(email) {
    const key = digest(email);
    const entry = get('SELECT * FROM beta_email_limits WHERE key=?', key);
    if (entry && (now() - entry.lastSentAt < 60_000 || entry.count >= 3))
      fail(429, 'Please check your inbox and spam folder. Wait before requesting another link; at most three confirmation emails can be requested per day.');
    const global = get('SELECT * FROM beta_email_limits WHERE key=?', 'daily-total');
    if (global && global.count >= dailyEmailLimit) fail(429, 'Beta email requests have reached today’s limit. Please try tomorrow or contact support.');
    for (const bucket of [key, 'daily-total'])
      run('INSERT INTO beta_email_limits(key,windowStart,count,lastSentAt) VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1,lastSentAt=excluded.lastSentAt', bucket, now(), now());
  }

  const handler = async (req, res, url) => {
    if (!url.pathname.startsWith('/api/beta/')) return false;
    cleanup();
    if (url.pathname === '/api/beta/config' && req.method === 'GET') {
      send(res, 200, { available, minimumAge: age, supportEmail });
      return true;
    }
    if (req.method !== 'POST') fail(404, 'Beta route not found.');
    limited(req, 'beta', 20);
    const data = await body(req, 4096);
    if (url.pathname === '/api/beta/signup') {
      if (!available) fail(503, 'Beta signup email is temporarily unavailable. Please try again later or contact support.');
      const email = string(data.email, 'email', { required: true, max: 254 }).toLowerCase();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'Enter a valid email address.');
      if (!DEVICES.has(data.device)) fail(400, 'Choose iPhone, Android, or both.');
      if (data.ageConfirmed !== true) fail(400, `Confirm you are ${age} or older to request beta access.`);
      if (typeof data.updatesConsent !== 'boolean') fail(400, 'Choose whether you want launch updates.');
      const campaign = source(data.source);
      const receiptToken = secret();
      const result = { ok: true, receiptToken, message: 'Check your inbox to confirm your email. Confirmation is not a TestFlight invitation.' };
      if (string(data.website, 'website', { max: 200 })) { send(res, 201, result); return true; }
      const confirmToken = secret(), unsubscribeToken = secret(), requestId = id('beta');
      transaction(() => {
        reserveDelivery(email);
        // A duplicate submission cannot change a confirmed person's preferences without email ownership.
        run(`INSERT INTO beta_subscribers(email,state,device,updatesConsent,ageConfirmedAt,createdAt,updatedAt,consentVersion)
          VALUES(?,'pending',?,0,?,?,?,?) ON CONFLICT(email) DO UPDATE SET updatedAt=excluded.updatedAt WHERE beta_subscribers.state='pending'`, email, data.device, now(), now(), now(), CONSENT_VERSION);
        run(`INSERT INTO beta_requests(id,email,receiptHash,confirmHash,device,updatesConsent,source,requestedAt,expiresAt)
          VALUES(?,?,?,?,?,?,?,?,?)`, requestId, email, digest(receiptToken), digest(confirmToken), data.device, Number(data.updatesConsent), campaign, now(), now() + 7 * DAY);
        run('INSERT INTO beta_unsubscribe_tokens(tokenHash,email,createdAt) VALUES(?,?,?)', digest(unsubscribeToken), email, now());
      });
      const confirmUrl = `${origin}/beta#confirm=${confirmToken}`;
      const unsubscribeUrl = `${origin}/beta#unsubscribe=${unsubscribeToken}`;
      const preference = data.updatesConsent ? 'You also asked to receive occasional Crewroom launch updates. You can change this after confirming.' : 'You have not opted in to launch updates.';
      const text = `Confirm your Crewroom beta request\n\nConfirm your email: ${confirmUrl}\n\nThis link expires in 7 days. Crewroom’s beta is for adults ${age}+. iPhone invitations are sent separately through TestFlight in small waves; confirming does not guarantee a place or create an app account. Android requests register interest for future updates.\n\n${preference}\n\nDid not request this, or changed your mind? Ignore this email, or remove the request and stop updates: ${unsubscribeUrl}\n\n${supportEmail ? `Questions: ${supportEmail}` : 'Visit Crewroom’s support page for help.'}`;
      try {
        await mailSender({ to: email, subject: 'Confirm your Crewroom beta request', text,
          html: `<h1>One step closer to your next crew.</h1><p>Confirm your email to request Crewroom beta access.</p><p><a href="${escape(confirmUrl)}">Confirm my email</a></p><p>This link expires in 7 days. The beta is ${age}+. An iPhone TestFlight invitation is sent separately; confirmation does not guarantee a place or create an account. Android requests register interest.</p><p>${escape(preference)}</p><p>If you did not request this, you can ignore it.</p><p><a href="${escape(unsubscribeUrl)}">Remove my request and stop updates</a></p><p>${escape(supportEmail)}</p>` });
      } catch {
        transaction(() => {
          run('DELETE FROM beta_requests WHERE id=?', requestId);
          run('DELETE FROM beta_unsubscribe_tokens WHERE tokenHash=?', digest(unsubscribeToken));
          run("DELETE FROM beta_subscribers WHERE email=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM beta_requests WHERE email=?)", email, email);
        });
        logger.warn?.('Beta confirmation email could not be delivered.');
        fail(503, 'We could not send the confirmation email. Please wait a minute and try again.');
      }
      send(res, 201, result);
      return true;
    }
    if (url.pathname === '/api/beta/details') {
      const hash = checkToken(data.receiptToken), fields = details(data);
      const request = get('SELECT id FROM beta_requests WHERE receiptHash=? AND expiresAt>? AND confirmedAt IS NULL', hash, now());
      if (!request) fail(400, 'This request has expired or was already confirmed. Use your email confirmation page to add details.');
      run('UPDATE beta_requests SET role=?,nextShoot=? WHERE id=?', fields.role, fields.nextShoot, request.id);
      send(res, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/beta/confirm') {
      const hash = checkToken(data.token);
      const manageToken = secret();
      const request = transaction(() => {
        const request = get('SELECT * FROM beta_requests WHERE confirmHash=? AND expiresAt>? AND confirmedAt IS NULL', hash, now());
        if (!request) fail(400, 'This link was already used or has expired. Request a new confirmation from the beta page.');
        run(`UPDATE beta_subscribers SET state='confirmed',device=?,updatesConsent=?,role=?,nextShoot=?,source=?,ageConfirmedAt=?,confirmedAt=?,updatedAt=?,consentVersion=? WHERE email=?`,
          request.device, request.updatesConsent, request.role, request.nextShoot, request.source, request.requestedAt, now(), now(), CONSENT_VERSION, request.email);
        run('DELETE FROM beta_requests WHERE email=? AND id<>?', request.email, request.id);
        run('UPDATE beta_requests SET receiptHash=NULL,confirmHash=NULL,confirmedAt=?,manageHash=?,manageExpiresAt=?,expiresAt=? WHERE id=?', now(), digest(manageToken), now() + DAY, now() + DAY, request.id);
        return request;
      });
      send(res, 200, { ok: true, manageToken, updatesConsent: Boolean(request.updatesConsent), role: request.role, nextShoot: request.nextShoot });
      return true;
    }
    if (url.pathname === '/api/beta/preferences') {
      const hash = checkToken(data.token), fields = details(data);
      if (typeof data.updatesConsent !== 'boolean') fail(400, 'Choose whether you want launch updates.');
      const request = get('SELECT email FROM beta_requests WHERE manageHash=? AND manageExpiresAt>? AND confirmedAt IS NOT NULL', hash, now());
      if (!request) fail(400, 'This preferences session has expired. Request a new confirmation from the beta page.');
      run('UPDATE beta_subscribers SET role=?,nextShoot=?,updatesConsent=?,updatedAt=? WHERE email=?', fields.role, fields.nextShoot, Number(data.updatesConsent), now(), request.email);
      send(res, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/beta/unsubscribe') {
      const hash = checkToken(data.token);
      const record = get('SELECT email FROM beta_unsubscribe_tokens WHERE tokenHash=?', hash);
      if (record) run('DELETE FROM beta_subscribers WHERE email=?', record.email);
      // Idempotent and generic: no API discloses another person's membership or address.
      send(res, 200, { ok: true }); return true;
    }
    fail(404, 'Beta route not found.');
  };
  handler.close = () => clearInterval(cleanupTimer);
  return handler;
}
