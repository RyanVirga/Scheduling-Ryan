# CraftAmplify Scheduler

Production-friendly scheduling UI that syncs against Google Calendar and renders availability in UTC.

## Prerequisites

- Node.js 20+
- Google Cloud project with Calendar API enabled
- OAuth 2.0 “Desktop” client credentials and refresh token with `https://www.googleapis.com/auth/calendar` scope

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the sensitive values:

   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
   - `GOOGLE_CALENDAR_ID` (use a single calendar ID or comma-separated list)
   - `SIGNING_SECRET` (use `openssl rand -base64 48` to generate)
   - `HOST_TIMEZONE` / `TZ_DEFAULT_HOST` (IANA identifiers, e.g. `America/Los_Angeles`)

3. In Google Calendar settings for each host calendar, enable **Automatically send event updates** so attendees receive confirmations and changes.

4. (Optional) Update `config/app.settings.json` and `config/availability.rules.json` to match host working hours. Rules are interpreted in the host timezone but converted to UTC when generating slots.

## Running Locally

- Development server: `npm run dev` (http://localhost:3000)
- Linting: `npm run lint`
- Tests (Vitest): `npm run test`

The scheduler fetches FreeBusy data in UTC and only converts to a guest timezone in the React client when rendering labels.

## Key Endpoints

- `GET /api/integrations/google/health` &mdash; checks token exchange + FreeBusy reachability (returns mock fallback details on failure).
- `GET /api/slots?meetingTypeId=...` &mdash; returns bookable slots per day (UTC timestamps).
- `POST /api/book` &mdash; creates a real Google Calendar event with `sendUpdates=all` to trigger email notifications.

## Troubleshooting

- **invalid_client** or **invalid_grant**: verify OAuth credentials and refresh token.
- **Missing GOOGLE_CALENDAR_ID**: ensure the calendar ID is present in `.env.local`.
- Use `curl http://localhost:3000/api/integrations/google/health` to confirm connectivity; the API automatically falls back to mocked slots if Google is unreachable.
