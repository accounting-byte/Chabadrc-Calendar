# Live Calendar Feeds

The calendar publishes three auto-updating feeds, matching the **Visibility** choice on the Export screen. No one has to press "Export" — a GitHub Action rebuilds them every ~15 minutes and only updates a feed when its events actually changed.

| Feed | Contains | Where it lives |
|---|---|---|
| **Public only** | Events marked Public | `feed/events.ics` and `feed/events.json` in this repo (the ChabadRC app reads these) |
| **Internal only** | Internal reservations, including maintenance | Secret GitHub Gist: `internal.ics`, `internal.json` |
| **Both** | Every booking — Public, Internal and not-yet-tagged | Secret GitHub Gist: `all.ics`, `all.json` |

Admins see the links for whichever Visibility is selected under **Export** in the calendar, with copy buttons, a "Subscribe in my calendar" link and the time of the last change.

### Why the Internal and Both feeds aren't in this repo
This repository is public, so anything committed here can be read by anyone. The Internal and Both feeds are written to a **secret Gist** instead — it isn't listed or searchable, and only people who have the link can open it (the same idea as Google Calendar's "secret address"). The links are stored in Firebase under `/feedConfig`, so they only appear inside the calendar, never in the repo or in the Action logs. **Treat those links like a password:** share them with staff only. If one leaks, delete the gist at gist.github.com — the next run creates a new one with new links.

**Public URLs**
- GitHub Pages: `https://accounting-byte.github.io/Chabadrc-Calendar/feed/events.json` (and `events.ics`)
- Without Pages: `https://raw.githubusercontent.com/accounting-byte/Chabadrc-Calendar/main/feed/events.json`

## What gets published
- Only **confirmed** events in every feed — pending requests and cancelled bookings stay out.
- **Public feed:** only events marked **Public**. Maintenance (type `t15`) is excluded. Older events with no visibility set are left out until someone tags them; during the switch-over you can set the variable `FEED_INCLUDE_UNSET` to `true` to include them.
- **Internal / Both feeds:** maintenance is included, so management sees every room block. Older untagged events appear in **Both** only.
- Window: 60 days back to ~13 months ahead.
- Never published in any feed: organizer email/phone, submitter, attendee count, setup requirements, users.

Change these without editing code via repo **Settings → Secrets and variables → Actions → Variables**:
`FEED_STATUSES` (e.g. `confirmed`), `FEED_EXCLUDE_TYPES` (public feed, e.g. `t15,t6`), `FEED_EXCLUDE_ROOMS` (public feed, e.g. `r3`), `FEED_PRIVATE_EXCLUDE_TYPES` (Internal/Both feeds), `FEED_PAST_DAYS`, `FEED_FUTURE_DAYS`, `FEED_INCLUDE_UNSET`.

## One-time setup
1. **Allow the Action to push:** Settings → Actions → General → Workflow permissions → *Read and write permissions*.
2. **Firebase token (recommended):** run `node build-feed.mjs --get-refresh-token` on any computer with Node 18+, then save the printed value as the repo secret `FIREBASE_REFRESH_TOKEN`. Without it the job still works but creates a new anonymous Firebase user on every run.
3. **Internal and Both feeds:** create a GitHub token that can only manage gists:
   - github.com → your profile picture → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**.
   - Note: `CRC calendar feeds`. Expiration: your choice (if it expires, the private feeds stop updating until you replace it). Scope: tick **only `gist`**.
   - Copy the token and save it in this repo as the secret **`FEED_GIST_TOKEN`** (Settings → Secrets and variables → Actions → New repository secret).
   - The gist is created under the account that owns the token.
4. **Firebase rules:** allow the job to save the private links. Firebase console → *Realtime Database* → *Rules*, and add a `feedConfig` entry next to the existing `rooms` / `events` / `users` entries:
   ```json
   "feedConfig": { ".read": "auth != null", ".write": "auth != null" }
   ```
   Mind the comma between entries, then click **Publish**. Without this the run log shows "Could not save the private feed links to Firebase" and the Export screen keeps saying "Not set up".
5. Actions tab → **Build live calendar feed** → *Run workflow*. The first run creates the secret gist and saves its links to Firebase; reopen **Export** in the calendar to see them.

If the job ever can't write to Firebase, it logs a warning. In that case open gist.github.com while signed in as the token owner, copy the gist's ID from its URL, and save it as the secret `FEED_GIST_ID`.

## Using the public feed in the ChabadRC app
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
      "organizer", "description", "recurringGroupId", "color", "status",
      "visibility": "public" }
  ]
}
```
Poll it (e.g. on app open / every 15 min), compare `version`, and replace the local list when it differs. Event `id`s are stable, so they can be used as keys for notifications. The private `internal.json` and `all.json` use the same format, with `"feed": "internal"` / `"all"` and each event's real `visibility` (`"public"`, `"internal"` or `null` if not tagged yet).

If `EVENT_TYPES` in `index.html` changes, update the same list in `build-feed.mjs`.
