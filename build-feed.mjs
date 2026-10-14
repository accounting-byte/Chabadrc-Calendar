#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  CRC Calendar → live export feeds
//
//  Reads rooms + events from the Firebase Realtime Database and publishes
//  three auto-updating feeds, each as .ics (calendar apps) and .json (apps):
//
//    Public only   → feed/events.ics, feed/events.json   (committed to this
//                    PUBLIC repo — the ChabadRC app reads these)
//    Internal only → internal.ics, internal.json  ┐ written to a SECRET GitHub
//    Both          → all.ics,      all.json       ┘ Gist, never to this repo
//
//  The secret Gist's links are saved in Firebase under /feedConfig, so the
//  calendar's Export screen can show them to signed-in staff without the
//  links ever appearing in the public repo.
//
//  Runs on a schedule from .github/workflows/build-feed.yml. Files are only
//  rewritten when their content actually changes.
//
//  Usage:
//    node build-feed.mjs                      # fetch from Firebase
//    node build-feed.mjs --input dump.json    # build from a local dump {rooms, events}
//    node build-feed.mjs --get-refresh-token  # one-time: print a token for the
//                                             # FIREBASE_REFRESH_TOKEN repo secret
//
//  Zero dependencies — needs Node 18+.
// ════════════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// ── Configuration (env vars override) ───────────────────────────
const CFG = {
  // Same public web config the calendar page already uses
  apiKey:      process.env.FIREBASE_API_KEY      || 'AIzaSyCtoqDtVZmVtdM6gs-KOxjsRmLCPyCNw2g',
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://chabad-calendar-a3ea7-default-rtdb.firebaseio.com',

  outDir:      process.env.FEED_OUT_DIR || 'feed',
  calName:     process.env.FEED_CAL_NAME || 'Chabad Russian Center',
  timezone:    process.env.FEED_TIMEZONE || 'America/New_York',

  // Only these statuses are published (comma list). Pending requests and
  // cancelled bookings stay out of every feed.
  statuses:    list(process.env.FEED_STATUSES, ['confirmed']),
  // Public feed: set FEED_INCLUDE_UNSET=true to also publish older events
  // that have no visibility yet (transition period only).
  includeUnset: process.env.FEED_INCLUDE_UNSET === 'true',
  // Event type ids kept out of the PUBLIC feed (t15 = Maintenance)
  excludeTypes: list(process.env.FEED_EXCLUDE_TYPES, ['t15']),
  // Room ids kept out of the PUBLIC feed (e.g. "r3" for the Mikvah)
  excludeRooms: list(process.env.FEED_EXCLUDE_ROOMS, []),
  // Event type ids kept out of the Internal / Both feeds (none by default,
  // so management sees maintenance blocks too)
  privateExcludeTypes: list(process.env.FEED_PRIVATE_EXCLUDE_TYPES, []),
  // Publish window relative to "now"
  pastDays:    num(process.env.FEED_PAST_DAYS, 60),
  futureDays:  num(process.env.FEED_FUTURE_DAYS, 400),

  // Secret Gist for the Internal / Both feeds
  gistToken:   process.env.FEED_GIST_TOKEN || '',   // classic token with only the "gist" scope
  gistId:      process.env.FEED_GIST_ID || '',      // optional secret — otherwise read from / saved to Firebase
  githubApi:   process.env.FEED_GITHUB_API || 'https://api.github.com',
  // Testing only: also write the private files to this local folder
  privateOutDir: process.env.FEED_PRIVATE_OUT_DIR || '',
};

// Mirrors EVENT_TYPES in index.html — keep in sync if types change there.
const EVENT_TYPES = {
  t1:  { name: 'Bar / Bat Mitzvah Club', color: '#1e3a6b' },
  t2:  { name: 'Classes and Lectures',   color: '#2d5a3d' },
  t3:  { name: 'Cteen',                  color: '#7a3a6b' },
  t4:  { name: 'Cteen Jr.',              color: '#5a2a6b' },
  t5:  { name: 'CYP',                    color: '#3a5a7a' },
  t6:  { name: 'Fundraising Dinner',     color: '#8a6a1a' },
  t7:  { name: 'Hebrew School',          color: '#2a6a4a' },
  t8:  { name: 'JCC',                    color: '#1a4a7a' },
  t9:  { name: 'Kids Programs',          color: '#3a7a5a' },
  t10: { name: 'Seniors Program',        color: '#6a3a2a' },
  t11: { name: 'Shul & Kiddush',         color: '#1a2a6a' },
  t12: { name: 'Womens Programs',        color: '#7a2a5a' },
  t13: { name: 'Gan',                    color: '#2a7a3a' },
  t14: { name: 'Tamim',                  color: '#4a2a8a' },
  t15: { name: 'Maintenance',            color: '#5a5a5a' },
  t16: { name: 'Community Event',        color: '#1a6a5a' },
};

// The three feeds. `file` is the base file name.
const VARIANTS = {
  public: {
    file: 'events', calName: CFG.calName,
    match: e => e.visibility === 'public' || (CFG.includeUnset && !e.visibility),
    excludeTypes: CFG.excludeTypes, excludeRooms: CFG.excludeRooms,
  },
  internal: {
    file: 'internal', calName: `${CFG.calName} — Internal`,
    match: e => e.visibility === 'internal',
    excludeTypes: CFG.privateExcludeTypes, excludeRooms: [],
  },
  all: {
    file: 'all', calName: `${CFG.calName} — All`,
    match: () => true,   // Public + Internal + not-yet-tagged
    excludeTypes: CFG.privateExcludeTypes, excludeRooms: [],
  },
};

function list(v, dflt) { return v == null || v === '' ? dflt : v.split(',').map(s => s.trim()).filter(Boolean); }
function num(v, dflt)  { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : dflt; }

// ── Firebase access (REST) ──────────────────────────────────────
// Reads /rooms and /events; reads and writes only /feedConfig.
async function postJSON(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url.split('?')[0]} → ${res.status} ${data?.error?.message || ''}`);
  return data;
}

async function signInAnonymously() {
  return postJSON(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.apiKey}`,
    { returnSecureToken: true });
}

async function getIdToken() {
  // The database rules require auth != null (the page signs in anonymously).
  // Reusing one stored refresh token avoids creating a new anonymous
  // Firebase user on every run.
  if (process.env.FIREBASE_ID_TOKEN) return process.env.FIREBASE_ID_TOKEN; // testing
  const refresh = process.env.FIREBASE_REFRESH_TOKEN;
  if (refresh) {
    const d = await postJSON(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`,
      { grant_type: 'refresh_token', refresh_token: refresh }, true);
    return d.id_token;
  }
  console.warn('::warning::FIREBASE_REFRESH_TOKEN not set — signing in anonymously (creates a new auth user each run). ' +
               'Run `node build-feed.mjs --get-refresh-token` once and save it as a repo secret.');
  return (await signInAnonymously()).idToken;
}

async function readRaw(node, token) {
  const res = await fetch(`${CFG.databaseURL}/${node}.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Read /${node} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function readNode(node, token) {
  const val = await readRaw(node, token);
  return val ? Object.values(val) : [];
}
async function writeRaw(node, value, token) {
  const res = await fetch(`${CFG.databaseURL}/${node}.json?auth=${encodeURIComponent(token)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Write /${node} failed: ${res.status} ${await res.text()}`);
}

async function loadData(argv) {
  const i = argv.indexOf('--input');
  if (i !== -1) {
    const raw = JSON.parse(await readFile(argv[i + 1], 'utf8'));
    const vals = x => Array.isArray(x) ? x : Object.values(x || {});
    return { rooms: vals(raw.rooms), events: vals(raw.events), token: process.env.FIREBASE_ID_TOKEN || null };
  }
  const token = await getIdToken();
  const [rooms, events] = await Promise.all([readNode('rooms', token), readNode('events', token)]);
  return { rooms, events, token };
}

// ── Transform: bookings → feed items ────────────────────────────
function buildItems({ rooms, events }, variantKey, now = new Date()) {
  const V = VARIANTS[variantKey];
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
  const from = new Date(now.getTime() - CFG.pastDays * 864e5);
  const to   = new Date(now.getTime() + CFG.futureDays * 864e5);

  return events
    .filter(e => e && e.id && e.title && e.start && e.end)
    .filter(e => CFG.statuses.includes(e.status || 'confirmed'))
    .filter(V.match)
    .filter(e => !V.excludeTypes.includes(e.typeId))
    .map(e => ({ e, start: new Date(e.start), end: new Date(e.end),
                 roomIds: e.roomIds || (e.roomId ? [e.roomId] : []) }))
    .filter(x => !isNaN(x.start) && !isNaN(x.end))
    .filter(x => x.end >= from && x.start <= to)
    .filter(x => !x.roomIds.some(r => V.excludeRooms.includes(r)))
    .sort((a, b) => a.start - b.start || String(a.e.id).localeCompare(String(b.e.id)))
    .map(({ e, start, end, roomIds }) => {
      const type = EVENT_TYPES[e.typeId];
      // NOTE: organizer email/phone, submitter, attendee count and setup
      // requirements are intentionally NOT published in any feed.
      return {
        id: String(e.id),
        title: e.title,
        start: start.toISOString(),
        end: end.toISOString(),
        status: e.status || 'confirmed',
        visibility: variantKey === 'public' ? 'public' : (e.visibility || null),
        type: type ? { id: e.typeId, name: type.name, color: type.color } : null,
        rooms: roomIds.map(id => ({ id, name: roomMap[id]?.name || id, floor: roomMap[id]?.floor || '' })),
        organizer: e.organizer || '',
        description: e.desc || '',
        recurringGroupId: e.recurGroupId || null,
        color: e.colorOverride || roomMap[roomIds[0]]?.color || type?.color || null,
      };
    });
}

// ── iCalendar (RFC 5545) ────────────────────────────────────────
const icsEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = iso => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 2026-10-12T14:00:00.000Z → 20261012T140000Z
const VIS_LABEL = { public: 'Public', internal: 'Internal' };

function fold(line) {
  // Fold at 75 octets without splitting multi-byte characters
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function buildICS(items, variantKey) {
  const V = VARIANTS[variantKey];
  const isPrivate = variantKey !== 'public';
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chabad Russian Center//Room Calendar Feed//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(V.calName)}`, `X-WR-TIMEZONE:${CFG.timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const it of items) {
    const location = it.rooms.map(r => r.floor ? `${r.name} (${r.floor})` : r.name).join(', ');
    const visLine = isPrivate ? `Visibility: ${VIS_LABEL[it.visibility] || 'Not set'}` : '';
    const desc = [it.description, it.organizer && `Organizer: ${it.organizer}`, visLine].filter(Boolean).join('\n\n');
    const cats = [it.type?.name, isPrivate && VIS_LABEL[it.visibility]].filter(Boolean).map(icsEsc).join(',');
    L.push('BEGIN:VEVENT',
      `UID:${icsEsc(it.id)}@chabadrc-calendar`,
      `DTSTAMP:${icsDate(it.start)}`,       // deterministic so unchanged events don't churn
      `DTSTART:${icsDate(it.start)}`,
      `DTEND:${icsDate(it.end)}`,
      `SUMMARY:${icsEsc(it.title)}`);
    if (location)  L.push(`LOCATION:${icsEsc(location)}`);
    if (desc)      L.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (cats)      L.push(`CATEGORIES:${cats}`);
    L.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ── JSON feed ───────────────────────────────────────────────────
function buildJSON(items, rooms, variantKey, version, updatedAt) {
  const V = VARIANTS[variantKey];
  return JSON.stringify({
    schema: 1,
    calendar: V.calName,
    ...(variantKey === 'public' ? {} : { feed: variantKey }),
    timezone: CFG.timezone,
    version,      // changes only when events change — cheap "anything new?" check
    updatedAt,
    count: items.length,
    rooms: rooms.map(r => ({ id: r.id, name: r.name, floor: r.floor || '', color: r.color || null }))
                .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })),
    eventTypes: Object.entries(EVENT_TYPES)
                .filter(([id]) => !V.excludeTypes.includes(id))
                .map(([id, t]) => ({ id, ...t })),
    events: items,
  }, null, 2) + '\n';
}

function buildVariant(data, key) {
  const V = VARIANTS[key];
  const items = buildItems(data, key);
  const rooms = data.rooms.filter(r => !V.excludeRooms.includes(r.id));
  // Version = hash of what's published (independent of run time)
  // (key name "publicRooms" kept so existing public-feed versions stay stable)
  const version = createHash('sha256').update(JSON.stringify({ items, publicRooms: rooms })).digest('hex').slice(0, 16);
  return {
    key, items, version,
    ics: buildICS(items, key),
    json: (updatedAt) => buildJSON(items, rooms, key, version, updatedAt),
  };
}

// ── Public feed → repo files ────────────────────────────────────
async function writePublic(data) {
  const v = buildVariant(data, 'public');
  const jsonPath = path.join(CFG.outDir, 'events.json');
  const icsPath  = path.join(CFG.outDir, 'events.ics');
  let prev = null;
  try { prev = JSON.parse(await readFile(jsonPath, 'utf8')); } catch {}

  if (prev?.version === v.version) {
    console.log(`Public feed: no changes (version ${v.version}, ${v.items.length} events).`);
    return;
  }
  await mkdir(CFG.outDir, { recursive: true });
  await writeFile(icsPath, v.ics);
  await writeFile(jsonPath, v.json(new Date().toISOString()));
  console.log(`Public feed updated: ${v.items.length} events (of ${data.events.length} bookings), version ${v.version}.`);
}

// ── Internal / Both feeds → secret Gist ─────────────────────────
async function gh(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : CFG.githubApi + url, {
    method,
    headers: {
      'Authorization': `Bearer ${CFG.gistToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'chabadrc-calendar-feed',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(
    new Error(`GitHub ${method} ${url.replace(/\/gists\/[^/?]+/, '/gists/***')} → ${res.status} ${text.slice(0, 200)}`),
    { status: res.status });
  return text ? JSON.parse(text) : {};
}

async function gistFileContent(f) {
  if (!f) return null;
  if (!f.truncated && typeof f.content === 'string') return f.content;
  const res = await fetch(f.raw_url);
  return res.ok ? res.text() : null;
}

const rawUrl = (owner, id, name) => `https://gist.githubusercontent.com/${owner}/${id}/raw/${name}`;

async function publishPrivate(data) {
  const variants = ['internal', 'all'].map(k => buildVariant(data, k));

  // Local copy (testing only)
  if (CFG.privateOutDir) {
    await mkdir(CFG.privateOutDir, { recursive: true });
    for (const v of variants) {
      await writeFile(path.join(CFG.privateOutDir, `${VARIANTS[v.key].file}.ics`), v.ics);
      await writeFile(path.join(CFG.privateOutDir, `${VARIANTS[v.key].file}.json`), v.json(new Date().toISOString()));
    }
  }

  if (!CFG.gistToken) {
    console.log('Internal / Both feeds: skipped — add the FEED_GIST_TOKEN secret to publish them (see FEED.md).');
    return;
  }

  // Where is the gist? env var → Firebase /feedConfig → create a new one
  let feedConfig = null;
  if (data.token) {
    try { feedConfig = await readRaw('feedConfig', data.token); }
    catch (e) { console.warn(`::warning::Could not read /feedConfig: ${e.message}`); }
  }
  let gistId = CFG.gistId || feedConfig?.gistId || '';
  const mask = id => { if (id && process.env.GITHUB_ACTIONS) console.log(`::add-mask::${id}`); };
  mask(gistId);   // keep the secret link out of the (public) Action logs
  let gist = null;
  if (gistId) {
    try { gist = await gh('GET', `/gists/${gistId}`); }
    catch (e) {
      if (CFG.gistId || e.status !== 404) throw e;   // only replace a gist that's really gone
      console.warn(`::warning::Saved gist not reachable (${e.message}) — creating a new one.`);
      gistId = '';
    }
  }

  // Work out which files changed
  const changed = {};
  for (const v of variants) {
    const base = VARIANTS[v.key].file;
    const prevJson = await gistFileContent(gist?.files?.[`${base}.json`]);
    let prevVersion = null;
    try { prevVersion = JSON.parse(prevJson).version; } catch {}
    if (prevVersion !== v.version) {
      const now = new Date().toISOString();
      changed[`${base}.json`] = { content: v.json(now) };
      changed[`${base}.ics`]  = { content: v.ics };
    }
  }

  if (!gist) {
    gist = await gh('POST', '/gists', {
      description: 'Chabad Russian Center — private calendar feeds (Internal / All). Staff only, do not share.',
      public: false,
      files: changed,
    });
    gistId = gist.id;
    mask(gistId);
    console.log('Created a new secret gist for the private feeds.');
  } else if (Object.keys(changed).length) {
    gist = await gh('PATCH', `/gists/${gistId}`, { files: changed });
  }

  const summary = variants.map(v => `${v.key}: ${v.items.length} events${changed[`${VARIANTS[v.key].file}.json`] ? ' (updated)' : ''}`).join(', ');
  console.log(`Private feeds — ${summary}.`);

  // Save links to Firebase so the calendar can show them to staff
  const owner = gist.owner?.login;
  const cfg = {
    gistId,
    internal: { ics: rawUrl(owner, gistId, 'internal.ics'), json: rawUrl(owner, gistId, 'internal.json') },
    all:      { ics: rawUrl(owner, gistId, 'all.ics'),      json: rawUrl(owner, gistId, 'all.json') },
  };
  const same = feedConfig && JSON.stringify({ gistId: feedConfig.gistId, internal: feedConfig.internal, all: feedConfig.all }) === JSON.stringify(cfg);
  if (!same) {
    if (data.token) {
      try { await writeRaw('feedConfig', cfg, data.token); console.log('Saved private feed links to Firebase /feedConfig.'); }
      catch (e) { console.warn(`::warning::Could not save links to Firebase (${e.message}). Find the gist at gist.github.com (signed in as the token owner) and save its ID as the FEED_GIST_ID secret.`); }
    }
  }
  // Never print the links themselves — Action logs of a public repo are public.
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--get-refresh-token')) {
    const d = await signInAnonymously();
    console.log('\nSave this as the repository secret FIREBASE_REFRESH_TOKEN:\n');
    console.log(d.refreshToken + '\n');
    return;
  }

  const data = await loadData(argv);
  await writePublic(data);
  await publishPrivate(data);
}

main().catch(err => { console.error('::error::' + err.message); process.exit(1); });
