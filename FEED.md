# Live Calendar Feed

The calendar publishes an auto-updating export that the ChabadRC app (and any calendar app) can subscribe to. No one has to press "Export" — a GitHub Action rebuilds it every ~15 minutes and only commits when events actually changed.

| File | Use |
|---|---|
| `feed/events.ics` | iCalendar feed — subscribe in Google / Apple / Outlook, or parse in the app |
| `feed/events.json` | Structured feed for the ChabadRC app |

**URLs**
- GitHub Pages: `https://accounting-byte.github.io/Chabadrc-Calendar/feed/events.json` (and `events.ics`)
- Without Pages: `https://raw.githubusercontent.com/accounting-byte/Chabadrc-Calendar/main/feed/events.json`

Admins also see both links, with a copy button and last-change time, in **Export** on the calendar.

## What gets published
- Only **confirmed** events — pending requests and cancelled bookings stay internal.
- **Maintenance** (type `t15`) is excluded.
- Window: 60 days back to ~13 months ahead.
- Never published: organizer email/phone, submitter, attendee count, setup requirements, users.

Change these without editing code via repo **Settings → Secrets and variables → Actions → Variables**:
`FEED_STATUSES` (e.g. `confirmed`), `FEED_EXCLUDE_TYPES` (e.g. `t15,t6`), `FEED_EXCLUDE_ROOMS` (e.g. `r3`), `FEED_PAST_DAYS`, `FEED_FUTURE_DAYS`.

## One-time setup
1. **Allow the Action to push:** Settings → Actions → General → Workflow permissions → *Read and write permissions*.
2. **Firebase token (recommended):** run `node scripts/build-feed.mjs --get-refresh-token` on any computer with Node 18+, then save the printed value as the repo secret `FIREBASE_REFRESH_TOKEN`. Without it the job still works but creates a new anonymous Firebase user on every run.
3. Actions tab → **Build live calendar feed** → *Run workflow* to publish the first version.

## Using it in the ChabadRC app
```
GET feed/events.json
{
  "version": "aa8543309beed6c0",   // changes only when events change
  "updatedAt": "2026-10-12T19:31:54Z",
  "timezone": "America/New_York",
  "rooms": [...], "eventTypes": [...],
  "events": [
    { "id", "title", "start", "end",        // ISO 8601 UTC
      "type": {"id","name","color"},
      "rooms": [{"id","name","floor"}],
      "organizer", "description", "recurringGroupId", "color", "status" }
  ]
}
```
Poll it (e.g. on app open / every 15 min), compare `version`, and replace the local list when it differs. Event `id`s are stable, so they can be used as keys for notifications.

If `EVENT_TYPES` in `index.html` changes, update the same list in `scripts/build-feed.mjs`.
