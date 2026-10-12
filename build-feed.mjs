#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  CRC Calendar → live export feed
//
//  Reads rooms + events from the Firebase Realtime Database and writes:
//    feed/events.ics   – iCalendar feed (subscribe in Google/Apple/Outlook)
//    feed/events.json  – structured feed for the ChabadRC app
//
//  Runs on a schedule from .github/workflows/build-feed.yml, so the files
//  are always a few minutes behind the live calendar at most.
//  Files are only rewritten when the published content actually changes.
//
//  Usage:
//    node scripts/build-feed.mjs                      # fetch from Firebase
//    node scripts/build-feed.mjs --input dump.json    # build from a local dump {rooms, events}
//    node scripts/build-feed.mjs --get-refresh-token  # one-time: print a token for the
//                                                     # FIREBASE_REFRESH_TOKEN repo secret
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
  // cancelled bookings stay internal.
  statuses:    list(process.env.FEED_STATUSES, ['confirmed']),
  // Event type ids to keep out of the public feed (t15 = Maintenance)
  excludeTypes: list(process.env.FEED_EXCLUDE_TYPES, ['t15']),
  // Room ids to keep out of the public feed (e.g. "r3" for the Mikvah)
  excludeRooms: list(process.env.FEED_EXCLUDE_ROOMS, []),
  // Publish window relative to "now"
  pastDays:    num(process.env.FEED_PAST_DAYS, 60),
  futureDays:  num(process.env.FEED_FUTURE_DAYS, 400),
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

function list(v, dflt) { return v == null || v === '' ? dflt : v.split(',').map(s => s.trim()).filter(Boolean); }
function num(v, dflt)  { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : dflt; }

// ── Firebase access (REST, read-only: only /rooms and /events) ──
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
  const refresh = process.env.FIREBASE_REFRESH_TOKEN;
  if (refresh) {
    const d = await postJSON(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`,
      { grant_type: 'refresh_token', refresh_token: refresh }, true);
    return d.id_token;
  }
  console.warn('::warning::FIREBASE_REFRESH_TOKEN not set — signing in anonymously (creates a new auth user each run). ' +
               'Run `node scripts/build-feed.mjs --get-refresh-token` once and save it as a repo secret.');
  return (await signInAnonymously()).idToken;
}

async function readNode(node, token) {
  const res = await fetch(`${CFG.databaseURL}/${node}.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Read /${node} failed: ${res.status} ${await res.text()}`);
  const val = await res.json();
  return val ? Object.values(val) : [];
}

async function loadData(argv) {
  const i = argv.indexOf('--input');
  if (i !== -1) {
    const raw = JSON.parse(await readFile(argv[i + 1], 'utf8'));
    const vals = x => Array.isArray(x) ? x : Object.values(x || {});
    return { rooms: vals(raw.rooms), events: vals(raw.events) };
  }
  const token = await getIdToken();
  const [rooms, events] = await Promise.all([readNode('rooms', token), readNode('events', token)]);
  return { rooms, events };
}

// ── Transform: internal bookings → public feed items ────────────
function buildItems({ rooms, events }, now = new Date()) {
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
  const from = new Date(now.getTime() - CFG.pastDays * 864e5);
  const to   = new Date(now.getTime() + CFG.futureDays * 864e5);

  return events
    .filter(e => e && e.id && e.title && e.start && e.end)
    .filter(e => CFG.statuses.includes(e.status || 'confirmed'))
    .filter(e => !CFG.excludeTypes.includes(e.typeId))
    .map(e => ({ e, start: new Date(e.start), end: new Date(e.end),
                 roomIds: e.roomIds || (e.roomId ? [e.roomId] : []) }))
    .filter(x => !isNaN(x.start) && !isNaN(x.end))
    .filter(x => x.end >= from && x.start <= to)
    .filter(x => !x.roomIds.some(r => CFG.excludeRooms.includes(r)))
    .sort((a, b) => a.start - b.start || String(a.e.id).localeCompare(String(b.e.id)))
    .map(({ e, start, end, roomIds }) => {
      const type = EVENT_TYPES[e.typeId];
      // NOTE: organizer email/phone, submitter, attendee count and setup
      // requirements are intentionally NOT published.
      return {
        id: String(e.id),
        title: e.title,
        start: start.toISOString(),
        end: end.toISOString(),
        status: e.status || 'confirmed',
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

function buildICS(items) {
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chabad Russian Center//Room Calendar Feed//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(CFG.calName)}`, `X-WR-TIMEZONE:${CFG.timezone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const it of items) {
    const location = it.rooms.map(r => r.floor ? `${r.name} (${r.floor})` : r.name).join(', ');
    const desc = [it.description, it.organizer && `Organizer: ${it.organizer}`].filter(Boolean).join('\n\n');
    L.push('BEGIN:VEVENT',
      `UID:${icsEsc(it.id)}@chabadrc-calendar`,
      `DTSTAMP:${icsDate(it.start)}`,       // deterministic so unchanged events don't churn
      `DTSTART:${icsDate(it.start)}`,
      `DTEND:${icsDate(it.end)}`,
      `SUMMARY:${icsEsc(it.title)}`);
    if (location)  L.push(`LOCATION:${icsEsc(location)}`);
    if (desc)      L.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (it.type)   L.push(`CATEGORIES:${icsEsc(it.type.name)}`);
    L.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// ── JSON feed for the app ───────────────────────────────────────
function buildJSON(items, rooms, version, updatedAt) {
  return JSON.stringify({
    schema: 1,
    calendar: CFG.calName,
    timezone: CFG.timezone,
    version,      // changes only when events change — cheap "anything new?" check
    updatedAt,
    count: items.length,
    rooms: rooms.map(r => ({ id: r.id, name: r.name, floor: r.floor || '', color: r.color || null }))
                .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })),
    eventTypes: Object.entries(EVENT_TYPES)
                .filter(([id]) => !CFG.excludeTypes.includes(id))
                .map(([id, t]) => ({ id, ...t })),
    events: items,
  }, null, 2) + '\n';
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
  const items = buildItems(data);
  const publicRooms = data.rooms.filter(r => !CFG.excludeRooms.includes(r.id));

  // Version = hash of what's published (independent of run time)
  const version = createHash('sha256').update(JSON.stringify({ items, publicRooms })).digest('hex').slice(0, 16);

  const jsonPath = path.join(CFG.outDir, 'events.json');
  const icsPath  = path.join(CFG.outDir, 'events.ics');
  let prev = null;
  try { prev = JSON.parse(await readFile(jsonPath, 'utf8')); } catch {}

  if (prev?.version === version) {
    console.log(`No changes (version ${version}, ${items.length} events).`);
    return;
  }

  await mkdir(CFG.outDir, { recursive: true });
  await writeFile(icsPath, buildICS(items));
  await writeFile(jsonPath, buildJSON(items, publicRooms, version, new Date().toISOString()));
  console.log(`Feed updated: ${items.length} events (of ${data.events.length} bookings), version ${version}.`);
}

main().catch(err => { console.error('::error::' + err.message); process.exit(1); });
