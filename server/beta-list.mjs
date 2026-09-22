#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Operator-only, read-only access. Never expose this output through the public app.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const help = `Crewroom beta waitlist (read-only)
  node server/beta-list.mjs [--db PATH]
  node server/beta-list.mjs --list [--updates-only] [--limit 100] [--offset 0] [--db PATH]

Default: aggregate counts only, without email addresses or other personal details.
--list: explicitly display confirmed requests, including private contact details.
--updates-only: with --list, include only confirmed requests that opted into launch updates.
--limit: 1–500 records per page (default 100); --offset: nonnegative page offset.
The output includes nextOffset when another page is available. Pending requests and
confirmation/manage tokens are never listed. This tool does not change the database,
send email, create TestFlight invitations, or synchronize a mailing list.
`;

function parseArgs(args) {
  const options = {
    dbPath: process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(root, '.data'), 'crewroom.sqlite'),
    list: false, updatesOnly: false, limit: 100, offset: 0, help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const [flag, ...valueParts] = args[index].split('=');
    if (!['--db', '--list', '--updates-only', '--limit', '--offset', '--help', '-h'].includes(flag))
      throw new Error(`Unknown option: ${flag}. Use --help for usage.`);
    const name = flag === '-h' ? '--help' : flag;
    if (seen.has(name)) throw new Error(`Supply ${name} only once.`);
    seen.add(name);
    if (['--list', '--updates-only', '--help'].includes(name)) {
      if (valueParts.length) throw new Error(`${name} does not take a value.`);
      options[name === '--updates-only' ? 'updatesOnly' : name.slice(2)] = true;
      continue;
    }
    const value = valueParts.length ? valueParts.join('=') : args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Supply a value for ${name}.`);
    if (name === '--db') {
      options.dbPath = value;
    } else {
      const number = Number(value);
      const minimum = name === '--limit' ? 1 : 0;
      const maximum = name === '--limit' ? 500 : Number.MAX_SAFE_INTEGER;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum)
        throw new Error(name === '--limit' ? '--limit must be an integer from 1 to 500.' : '--offset must be a nonnegative safe integer.');
      options[name.slice(2)] = number;
    }
  }
  if (!options.help && !options.list && (options.updatesOnly || seen.has('--limit') || seen.has('--offset')))
    throw new Error('Use --updates-only, --limit, and --offset with --list.');
  return options;
}

function sourceObject(value) {
  try { return JSON.parse(value); } catch { return null; }
}

let db;
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
  } else {
    if (!existsSync(options.dbPath))
      throw new Error('Database not found. Start or deploy the updated Crewroom server first, or specify an existing database with --db.');
    db = new DatabaseSync(options.dbPath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='beta_subscribers'").get())
      throw new Error('Beta waitlist schema is not initialized. Start or deploy the updated Crewroom server first.');
    let result;
    if (!options.list) {
      const counts = db.prepare(`SELECT COUNT(*) AS total,
        COUNT(CASE WHEN state='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN state='confirmed' THEN 1 END) AS confirmed,
        COUNT(CASE WHEN device='iphone' THEN 1 END) AS iphone,
        COUNT(CASE WHEN device='android' THEN 1 END) AS android,
        COUNT(CASE WHEN device='both' THEN 1 END) AS both,
        COUNT(CASE WHEN state='confirmed' AND updatesConsent=1 THEN 1 END) AS confirmedLaunchUpdates
        FROM beta_subscribers`).get();
      result = {
        total: counts.total,
        states: { pending: counts.pending, confirmed: counts.confirmed },
        devices: { iphone: counts.iphone, android: counts.android, both: counts.both },
        confirmedLaunchUpdates: counts.confirmedLaunchUpdates,
      };
    } else {
      const where = `state='confirmed'${options.updatesOnly ? ' AND updatesConsent=1' : ''}`;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM beta_subscribers WHERE ${where}`).get().n;
      const rows = db.prepare(`SELECT email,device,role,nextShoot,createdAt,confirmedAt,updatesConsent,source
        FROM beta_subscribers WHERE ${where} ORDER BY createdAt,email LIMIT ? OFFSET ?`).all(options.limit + 1, options.offset);
      const subscribers = rows.slice(0, options.limit).map(row => ({ ...row, source: sourceObject(row.source) }));
      result = { count: subscribers.length, total, limit: options.limit, offset: options.offset,
        nextOffset: rows.length > options.limit ? options.offset + options.limit : null, subscribers };
    }
    db.exec('COMMIT;');
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
