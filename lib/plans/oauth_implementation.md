# Plan: OAuth 2.0 Authentication for DizynOps

## Overview

Replace the manual Personal Access Token (PAT) flow with a one-click OAuth 2.0
authorization experience. The user clicks "Authorize with Figma", approves access
in their browser, and the plugin receives a token automatically — no copy-pasting.

## Architecture

Two parts:
1. **`Dizyn-Ops-Auth`** — a separate private repo, deployed to Vercel, handling
   the OAuth token exchange server-side.
2. **`Dizyn-Ops`** (this repo) — plugin changes to initiate the OAuth flow,
   poll for the token, and save it via `figma.clientStorage`.

---

## Part 1 — Server Repo (`Dizyn-Ops-Auth`)

### Setup

- New private GitHub repo: `Dizyn-Ops-Auth`
- Deploy to Vercel (free tier)
- Add Vercel KV (free tier) for temporary token storage

### File structure

```
dizyn-ops-auth/
  api/
    callback.ts     ← receives OAuth redirect from Figma
    token.ts        ← plugin polls this to retrieve the token
  package.json
  vercel.json
  .env              ← never committed
  .env.example      ← committed, documents required vars
  README.md
```

### Environment variables (`.env`)

```
FIGMA_CLIENT_ID=...
FIGMA_CLIENT_SECRET=...
FIGMA_REDIRECT_URI=https://dizyn-ops-auth.vercel.app/api/callback
KV_REST_API_URL=...       ← provided by Vercel KV
KV_REST_API_TOKEN=...     ← provided by Vercel KV
```

### `api/callback.ts`

Receives the redirect from Figma after the user approves:

1. Extract `code` and `state` from query params
2. Validate `state` is present
3. POST to `https://api.figma.com/v1/oauth/token`:
   - `grant_type=authorization_code`
   - `client_id`, `client_secret`, `redirect_uri`, `code`
4. Store the returned `access_token` in Vercel KV under key `oauth:${state}`
   with a TTL of 300 seconds (5 minutes)
5. Return a simple HTML page: "Authorization successful. You can close this tab."

### `api/token.ts`

The plugin polls this endpoint while waiting:

1. Extract `state` from query params
2. Look up `oauth:${state}` in Vercel KV
3. If found: delete the key (single-use), return `{ token: "..." }`
4. If not found: return `{ token: null }`

### Registering the Figma OAuth app

1. Go to figma.com/developers → "Create new app"
2. Set redirect URI to `https://dizyn-ops-auth.vercel.app/api/callback`
3. Note the `client_id` and `client_secret`
4. Required scope: `files:read`

---

## Part 2 — Plugin Changes (`Dizyn-Ops`)

### `manifest.json`

Add the Vercel domain to `networkAccess.allowedDomains`:

```json
"networkAccess": {
  "allowedDomains": ["api.figma.com", "dizyn-ops-auth.vercel.app"],
  "reasoning": "api.figma.com for library name resolution; dizyn-ops-auth.vercel.app for OAuth token retrieval."
}
```

### `src/shared/messages.ts`

Add new message types:

```ts
// UI → Sandbox
{ type: "start-oauth" }

// Sandbox → UI
{ type: "oauth-waiting" }                    // polling started, show waiting state
{ type: "oauth-success" }                    // token received and saved
{ type: "oauth-error"; message: string }     // timeout or network failure
```

Remove (no longer needed):
- `SavePatMessage`
- `ClearPatMessage`
- `LoadPatMessage`
- `PatLoadedMessage`

### `src/code.ts`

Handle `start-oauth`:

1. Generate a random `state` string (use `crypto.getRandomValues`)
2. Save `state` to `figma.clientStorage` (for validation on retrieval)
3. Open the Figma OAuth URL via `figma.openExternal()`:
   ```
   https://www.figma.com/oauth
     ?client_id=FIGMA_CLIENT_ID
     &redirect_uri=https://dizyn-ops-auth.vercel.app/api/callback
     &scope=files:read
     &state={state}
     &response_type=code
   ```
4. Post `{ type: "oauth-waiting" }` to the UI
5. Begin polling `https://dizyn-ops-auth.vercel.app/api/token?state={state}`
   every 2 seconds, up to 60 attempts (2 minutes total)
6. On success: save token via `figma.clientStorage.setAsync("figma-token", token)`,
   post `{ type: "oauth-success" }` to UI
7. On timeout: post `{ type: "oauth-error", message: "Authorization timed out." }`

Remove: `load-pat`, `save-pat`, `clear-pat` handlers (replaced by `start-oauth`).
Keep `open-url` if still used elsewhere.

### `src/ui/App.tsx`

Replace PAT-related state and UI:

- Remove: `pat`, `patInput`, `handleConnectAndScan`, `handleDisconnectPat`, PAT input form
- Add: `oauthState: "idle" | "waiting" | "error"` state
- Connect view becomes a single button: **"Authorize with Figma"**
  - Clicking it sends `{ type: "start-oauth" }` to `code.ts`
  - Transitions to a "Waiting for authorization…" state with a spinner
  - On `oauth-success`: start the scan automatically
  - On `oauth-error`: show the error message with a retry button
- Results view: keep a "Disconnect" option that clears the token from
  `clientStorage` and resets to idle

---

## Full user flow (end state)

```
User clicks "Scan Components"
  → No token stored
  → Plugin shows "Authorize with Figma" button

User clicks "Authorize with Figma"
  → Plugin generates state="abc123", saves to clientStorage
  → Browser opens: figma.com/oauth?client_id=...&state=abc123&scope=files:read
  → Plugin shows "Waiting for authorization…" spinner
  → Plugin starts polling /api/token?state=abc123 every 2s

User clicks "Allow" in browser
  → Browser redirects to: dizyn-ops-auth.vercel.app/api/callback?code=XYZ&state=abc123
  → Server exchanges code → access token
  → Server stores token in KV under key "oauth:abc123" (TTL: 5 min)
  → Browser tab shows "Authorization successful. You can close this tab."

Plugin poll succeeds
  → Token saved to figma.clientStorage
  → Scan starts automatically
  → UI transitions to scanning state
```

---

## Effort estimate

| Task | Time |
|---|---|
| Register Figma OAuth app | ~5 min |
| Create `Dizyn-Ops-Auth` repo and set up Vercel + KV | ~30 min |
| Write `api/callback.ts` and `api/token.ts` | ~1–2 hr |
| Update plugin (`manifest.json`, `code.ts`, `App.tsx`) | ~1–2 hr |
| End-to-end testing | ~1 hr |
| **Total** | **~half a day** |

---

## Notes

- The `client_secret` never touches the plugin. It only lives in Vercel
  environment variables.
- Figma's OAuth also returns a `refresh_token` — you can optionally implement
  silent token refresh later so users never have to re-authorize.
- The KV store only holds tokens for 5 minutes. If the user takes longer than
  that to authorize, they just click the button again.
- Once built, the server is effectively zero-maintenance — it only runs on
  authorization events.
- When ready to implement, start with the server repo first and verify the
  `/callback` → `/token` flow works end-to-end before touching the plugin.
