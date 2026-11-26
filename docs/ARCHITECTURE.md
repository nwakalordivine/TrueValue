# TrueValue architecture

This document describes the code after the v2 work (Phases 0 to 6, on the `dev` branch). Sections 5 and 6 are the findings from Phase 0 (commit `b92b055`), kept for history. Each item now has a **Status** line saying what happened to it.

## 1. The big picture

```
Browser (Vite multi-page app, plain JS). Every page calls mountShell() from src/components/shell.js
  index.html   -> src/main.js     (values, find a product, demo products, feedback, About)
  result.html  -> src/result.js   (one product: score, why, consider instead, evidence, stores, disposal)
  chat.html    -> src/chat.js     (assistant)
  compare.html -> src/compare.js  (up to 3 products side by side)
  nearme.html  -> src/nearme.js   (stores and recycling drop-offs)
        |
        |  every call goes through src/api.js  (base URL = VITE_API_URL, adds the access token)
        v
FastAPI on Vercel (backend/app/main.py exposes `app`, routers mounted under /api)
        |
        +-- Neon Postgres (SQLAlchemy async + asyncpg): demo catalog, feedback, registry, users, codes, refresh tokens
        +-- Redis (optional, fail-soft): response cache and rate limits
        +-- Open Food Facts: real products by barcode and by name
        +-- OpenStreetMap: Overpass (stores, drop-offs) with Nominatim as backup
        +-- OpenRouter (optional): AI parsing and wording for the assistant
        +-- Gmail SMTP: sign-in codes and feedback emails
        +-- Cloudinary (optional): profile pictures
```

The browser computes nothing it has to trust. The backend recomputes the score for every request, and it never stores a score.

Optional services never take the app down:
- **Without `REDIS_URL`:** nothing is cached, and rate limits fall back to database counts where it matters.
- **Without `OPENROUTER_API_KEY`:** the assistant runs in rule-based mode.
- **Without `JWT_SECRET`:** sign-in answers 503.
- **Without a valid `CLOUDINARY_URL`:** picture uploads answer 503.

## 2. Folder map

### Backend (`backend/`)

| Path | What it does |
|---|---|
| `app/main.py` | Creates the FastAPI app. On startup (`lifespan`) it warns if `CLOUDINARY_URL` is malformed, lists the existing tables in one query and only when some are missing enables `pg_trgm` and runs `create_all` for those. Then it loads the catalog into memory, seeding the demo catalog first if its tables are empty. It logs `Startup: database X s, catalog Y s`, the cold-start cost on Vercel. If the database part fails it logs the error and serves from the JSON files instead. It also sets up CORS from `CORS_ORIGINS`, mounts every router under `/api`, and defines `/api/health`. |
| `app/config.py` | `Settings` (pydantic-settings). Reads environment variables, then `backend/.env`; real environment variables win. Helpers: `auth_enabled`, `avatars_enabled` (only for a well-formed `cloudinary://key:secret@cloud`), `admin_emails`. |
| `app/database.py` | Builds the async engine **when the module is imported**, using `settings.DATABASE_URL`, plus `SessionLocal` and `get_db`. The default URL is a local SQLite file (`sqlite+aiosqlite`). |
| `app/models.py` | Tables. Catalog tables keep their key columns as real columns and store the full record in a JSON `data` column, so the API returns exactly the shape of the JSON files. Also `Feedback`, `Corporation` (the federal registry), and the account tables `User`, `EmailCode`, `RefreshToken` (section 7). Times are UTC (`utcnow`, `as_utc`). |
| `app/schemas.py` | Pydantic request bodies: catalog and chat bodies, and the account bodies (`RequestCodeIn`, `VerifyCodeIn`, `RefreshIn`, `UsernameIn`, `PreferencesIn`, `EmailRequestIn`, `EmailConfirmIn`). Usernames: 2 to 30 letters, numbers, spaces, `_ . -`. |
| `app/redis_client.py` | `cache_get`, `cache_set`, `hit_rate_limit`, `ping`. With no `REDIS_URL`, or when Redis errors, they return None/False, so a request is **never blocked** by Redis. |
| `app/routers/catalog.py` | `GET /catalog`, `POST /products/{id}/card`, `GET /products/{id}/disposal`, `POST /barcode`, `GET /search`. |
| `app/routers/chat.py` | `POST /chat`: rate limited per IP (`x-forwarded-for`), with a hard 45 s answer budget because Vercel stops functions at 60 s. |
| `app/routers/companies.py` | `GET /companies/search`, `GET /companies/{number}`: the Corporations Canada registry. |
| `app/routers/places.py` | `GET /places/stores`, `GET /places/drop-offs`. |
| `app/routers/feedback.py` | `POST /feedback` (anyone) saves to the DB, then emails. `GET /feedback` lists recent feedback for signed-in users in `ADMIN_EMAILS` only. |
| `app/routers/auth.py` | `POST /auth/request-code`, `/auth/verify-code`, `/auth/refresh`, `/auth/logout` (section 7). |
| `app/routers/me.py` | `GET/PATCH /me`, `PUT /me/preferences`, `POST/DELETE /me/avatar`, `POST /me/email/request`, `POST /me/email/confirm` (section 7). |
| `app/routers/diagnostics.py` | `GET /diagnostics` times every outside service from inside Vercel. |
| `app/services/auth.py` | Codes (HMAC-SHA256 hashes, expiry, attempts, rate limits), JWTs, refresh rotation, and the `get_current_user` and `require_admin` dependencies. |
| `app/services/avatars.py` | Cloudinary upload (256x256 face crop, folder `truevalue/avatars`) and delete, run in a thread. The SDK is imported only when it is used, because importing it with a malformed `CLOUDINARY_URL` in the environment raises and would stop the whole API from starting. |
| `app/services/scoring.py` | The scoring model (pure Python), kept identical to the frontend copy. |
| `app/services/assistant.py` | Builds the True Value Card (`product_card`), handles barcode lookup (`lookup_barcode`), and holds the chat handlers and the AI summary guard. |
| `app/services/parser.py` | Rule-based intent parser, plus `merge_llm`, which keeps the AI from inventing products or dimensions. |
| `app/services/llm.py` | OpenRouter client: primary then fallback model, inside a strict time budget. Returns None on any failure. |
| `app/services/openfoodfacts.py` | `fetch` (barcode), `search` (by name), and `to_truevalue`, which turns OFF label data into TrueValue claims. |
| `app/services/places.py` | Overpass mirrors (fastest first), with Nominatim as fallback. Results are cached by rounded location. |
| `app/services/registry.py` | Trigram search over the `corporations` table. |
| `app/services/disposal.py` | City of Regina bin rules: blue cart, SARCAN, SARCAN refund, garbage, check. |
| `app/services/catalog.py` | Seeds the DB from `backend/data/*.json` and keeps the catalog in memory, falling back to the JSON files. |
| `app/services/mailer.py` | SMTP over STARTTLS (Gmail App Password), run in a thread. `send` emails the team (`FEEDBACK_EMAIL`); `send_to` emails anyone (sign-in codes). |
| `data/*.json` | Demo catalog: products, companies, claims, certifications, prices, retailers, dimensions, default weights. |
| `scripts/seed.py`, `scripts/import_corporations.py` | Reload the demo catalog, and import the Corporations Canada CSV with Postgres COPY. |
| `tests/test_logic.py` | Scoring, the parser and disposal. No DB or network. |
| `tests/test_auth.py` | Sign-in, codes, tokens, `/me`, avatars, email change and the admin feedback list. Runs on in-memory SQLite with the mailer, Redis and Cloudinary faked. Also starts `app.main` with a malformed `CLOUDINARY_URL` to prove the API still loads. |
| `tests/test_feedback.py` | Feedback saving and email. |
| `pyproject.toml` + `uv.lock` | Local dependencies (uv). pytest is a dev-only dependency; run `uv run pytest`. |
| `requirements.txt` | What Vercel installs. Must list every runtime dependency (now also PyJWT, cloudinary, python-multipart). |
| `vercel.json` | `maxDuration` 60 s for `app/main.py`. |

### Frontend (`frontend/`)

| Path | What it does |
|---|---|
| `index.html`, `result.html`, `chat.html`, `compare.html`, `nearme.html` | Empty `#app` shells. Each loads one script. All five are inputs in `vite.config.js`. |
| `src/main.js` + `styles/home.css` | Home: your values (sliders and budget), Find a product with three tabs (Scan, Upload photo, Search by name), two demo products, Report a problem, and About with the team cards. Loads `/api/catalog`, or falls back to the bundled JSON ("Offline mode"). |
| `src/result.js` + `result.css` | Result page: score, why, consider instead, evidence and sources, where to buy, disposal. |
| `src/chat.js` + `chat.css` | Assistant page, with camera and photo barcode buttons. |
| `src/compare.js` + `styles/compare.css` | Compare page: the products in the compare tray, scored by the backend with the shopper's values. |
| `src/nearme.js` + `styles/nearme.css` | Near me page: stores and recycling drop-offs, as tabs. |
| `src/api.js` | The only place that calls the backend. `request()` adds the access token, and on a 401 refreshes the session once (shared by requests that fail together) and retries. File uploads go as `FormData`. |
| `src/apiBase.js` | `API_BASE` from `VITE_API_URL`, on its own so node tests can import the API client. |
| `src/components/shell.js` | The shell for every page: top bar, sidebar (drawer below 1024px, fixed above), the account popup card, backdrop, focus trap, Escape, `inert` on the rest of the page while a drawer or the card is open. |
| `src/components/account.js` | Everything that depends on being signed in: the account card's screens (sign-in, code, profile, change email), the sidebar's account area, and the avatars. |
| `src/components/codeEntry.js` | The 6-digit code screen: paste, auto-advance, backspace, Resend with a 60 s countdown, a way back. Used for sign-in and email change. |
| `src/components/compare.js` | "Compare" buttons and the events that keep the tray count in step. |
| `src/components/tabs.js` | Accessible tabs (arrow keys, Home, End). |
| `src/components/team.js` | Team cards for About. A missing photo shows initials. |
| `src/components/icons.js` | Lucide outline icons as SVG strings (only the ones imported are bundled), plus a drawn LinkedIn icon. |
| `src/components/views.js` | Shared HTML builders: `esc`, `money`, `statusBadge`, `verdictPill`, `placeList`, `disposalView`, `locationLine`, `scanResultView`. |
| `src/services/session.js` | Tokens and the user in localStorage (`truevalue-auth-v1`), `onAuthChange`, the shared refresh, and the guard that drops a session whose refresh token has expired. |
| `src/services/auth.js` | `login`, `verify`, `logout`, `currentUser`, `onAuthChange`, `checkSession` (once per page). |
| `src/services/preferencesSync.js` | Keeps a signed-in user's weights and budget in step with the account (section 3). |
| `src/services/profile.js` | Rename, upload or remove the picture, request and confirm an email change; each stores the returned user. |
| `src/services/imageResize.js` | Shrinks a picked picture to at most 512 px (JPEG 0.85) before upload. |
| `src/services/scoringService.js` | Frontend copy of the scoring model (demo cards and offline mode). |
| `src/services/customerValuesService.js` | `loadUser` and `saveUser` in localStorage, key `truevalue-user-v2`. |
| `src/services/compareTray.js` | Up to 3 items to compare, in localStorage, key `truevalue-compare-v1`. |
| `src/services/barcodeScanner.js` | zxing-wasm camera and photo decoding, loaded lazily. |
| `src/services/locationService.js` | Browser geolocation, cached per session, falling back to downtown Regina. |
| `src/services/teamService.js` | Initials and photo paths for the team cards (no DOM, so tests can import it). |
| `src/services/recommendationService.js`, `provenanceService.js`, `feedbackService.js` | Offline alternatives, provenance labels, and offline feedback saved to localStorage. |
| `src/styles/tokens.css` | The design tokens: colours, type scale, 4 px spacing scale, radius, sizes. Every other stylesheet uses them. |
| `src/styles/base.css`, `shell.css`, `account.css` | Base elements and buttons, the shell and card, the account screens. |
| `src/data/*.json` | Offline copies of the demo catalog (byte-identical to `backend/data`), plus `team.json`. |
| `public/team/` | Team photos, served at `/team/`. |
| `tests/*.test.js` | `node --test`: scoring, team, sign-in (`auth.test.js`) and profile (`profile.test.js`). |

## 3. How a request flows

**Page load.** Each page calls `mountShell()`, which draws the shell and the account card from the stored session, then runs `checkSession()` once the browser is idle. If signed in, that calls `GET /api/me` to prove the session still works and syncs the saved values. Home draws the values, finder and demo products at once from `src/data/*.json`, then calls `GET /api/catalog` in the background and redraws only if the server copy differs. If the call fails, the status line says the bundled demo data is shown.

**Scan or upload a barcode.**
1. zxing-wasm decodes the barcode in the browser.
2. The browser goes to `/result.html?barcode=...`.
3. `result.js` calls `POST /api/barcode` with the saved weights.
4. `assistant.lookup_barcode` checks the demo catalog first. If the barcode is not there, it calls `openfoodfacts.fetch`: Redis cache first (24 h), then `world.openfoodfacts.org/api/v2/product/{code}.json`.
5. `to_truevalue` turns the label data into six Claimed or Unknown claims, `product_card` scores them, and `registry.search_companies` looks up the brand owner in Neon.

**Search by name.** `GET /api/search` calls `openfoodfacts.search` (no demo products): Redis cache first (6 h), then `search.openfoodfacts.org`. When the words name a kind of product (`category_tag`: water, coffee, oat milk...), it first searches that Open Food Facts category in Canada sorted by popularity, so well-known products with fuller labels come first. Then Canada without the category, then worldwide, then the old `cgi/search.pl` as a last resort. The search server's field is `countries:"en:canada"`; `countries_tags` is rejected with HTTP 400.

**Near me.** `GET /api/places/stores` or `/drop-offs` goes to `places.py`: Redis cache first (6 h), then the Overpass mirrors in order within a 14 s budget, then Nominatim within an 8 s budget. The response gives distances and OSM directions links. Stock is always shown as Unknown.

**Assistant.**
1. `POST /api/chat` checks the per-IP rate limit (Redis).
2. `parser.rule_parse` works out the intent.
3. If an OpenRouter key is set, `llm.complete_json` refines the parse, cached in Redis for 1 h. `merge_llm` throws away any invented product or dimension.
4. The handler for the intent runs (recommend, compare, explain, where to buy, dispose, company check, barcode, help).
   Recommend and compare use **real products** unless the shopper names demo products: `parser` takes the product words out of the question (`search_terms`: "canned water high on fair trade" gives "canned water"), `assistant.real_products` makes one `openfoodfacts.search(..., full=True)` call whose hits carry the label data (`from_search` converts them, so there is no request per product; the product API answers HTTP 429 to bursts), scores them with the shopper's weights and returns the top 3. "Consider instead" only lists other real products from the same search. If nothing is found it says so; it never falls back to demo products.
5. Optionally, the AI rewords the template answer. `_summarize` rejects any answer that names a product not in the results.

**Feedback.** `POST /api/feedback` saves a `Feedback` row in Neon, then `mailer.send` emails `FEEDBACK_EMAIL` over SMTP. If the server is down, the browser saves the feedback in localStorage instead.

**Sign in.**
1. The account card has two tabs. **Sign in** asks only for the email (`mode: signin`; 404 if no account). **Sign up** asks for email and username (`mode: signup`; 409 if the email already has an account). Either error offers a button to the other tab. `POST /api/auth/request-code` stores a hash of a new 6-digit code, cancels earlier unused codes for that email, and emails the code with `mailer.send_to`.
2. The code screen sends `POST /api/auth/verify-code`, with the username again for a new email, because `email_codes` has no username column.
3. The response's tokens and user go into `session.js`, and `onAuthChange` redraws the avatars and the sidebar.

**Saved values** (`preferencesSync.js`). Only `weights` and `budget_cad` are synced.
- **At sign-in:** if the account has no saved values, the local ones are uploaded. Otherwise the saved ones replace them, with "Loaded your saved values."
- **While signed in:** each change is saved locally at once and sent to `PUT /api/me/preferences` 800 ms after the last change.
- **Unsynced changes:** until a save succeeds, the `truevalue-prefs-unsynced` flag is set. If the page closes first, `checkSession` pushes the local values next time instead of loading older ones from the server.
- **Logging out** keeps the values in the browser.

**Profile.**
- **Picture:** picked, resized in the browser (`imageResize.js`) and shown as a preview straight away, then sent to `POST /api/me/avatar` as `FormData`. The server checks the type and bytes (JPEG, PNG or WebP, at most 4 MB), uploads to Cloudinary and deletes the previous picture.
- **Username:** `PATCH /api/me`.
- **Email change:** `POST /api/me/email/request` answers 409 if another account has that email. The card then shows a 5 s countdown and goes home. Otherwise the code screen runs and sends `POST /api/me/email/confirm`.
- **Every change** stores the returned user, so the avatars and names in the shell update straight away.

## 4. How the score, coverage and verified percent are calculated

Source of truth: `backend/app/services/scoring.py`, function `calculate_match` (lines 26 to 65). The frontend copy is `frontend/src/services/scoringService.js`, function `calculateMatch`. **Neither file may change, and scores must stay identical.**

For each of the six dimensions (`canadian_ownership`, `local_business`, `fair_trade`, `animal_welfare`, `environment`, `packaging`):

- `weight` = the shopper's weight, clamped to 0 to 100.
- The product's claim for that dimension is **scored** only if its status is `Verified` or `Claimed` **and** it has a numeric `raw_score`. Anything else is Unknown and has no score.
- `contribution` = weight × raw_score, for scored rows only.

Then, over all rows:

| Output | Formula | Meaning |
|---|---|---|
| `raw_score` (the match score) | round( Σ contribution / Σ weight of scored rows that have weight > 0 ), or `null` if no weighted row has a score | Average of the known scores, weighted by what the shopper cares about. **Unknown is left out, never counted as zero.** |
| `coverage_percent` | round( Σ (weight × claim coverage_percent / 100) over scored rows / Σ all weights × 100 ) | How much of what the shopper cares about we actually have evidence for. Unknown dimensions lower coverage. |
| `confidence` | Σ (weight × claim confidence) / Σ weight of scored rows, to 2 decimals | A demo heuristic, not a probability. |
| `verified_percent` | round( Σ weight of rows with status `Verified` / Σ all weights × 100 ) | How much of the weighted picture is independently verified. **Only the backend computes this.** The frontend `calculateMatch` does not return it. |

Related functions:

- `rank_products`: sorts by score, then coverage, then name.
- `alternatives`: better-scoring products, same category first.
- `verdict`: the label (Good fit, Consider instead, Buy with caution, Weak fit, Not enough data) and its sentence.
- `highlights`: the top 3 weighted rows.
- `assistant.product_card`: combines all of these into the True Value Card.
- Open Food Facts products: `openfoodfacts._claim` marks every known value as `Claimed`, with confidence 0.35 and coverage 100, and missing data as `Unknown`. So a real scanned product always has `verified_percent` = 0.

**Where each page gets its numbers.**
- Demo product cards on Home use the frontend `calculateMatch`.
- The compare page, the result page and the assistant use the backend card (`/products/{id}/card`, `/barcode`, `/chat`).
- `backend/tests/test_logic.py::test_matches_frontend_for_prairie_morning` pins Prairie Morning Coffee at 74/100 with 91% coverage under the default weights.

## 5. Where the v2 brief did not match the code (Phase 0 findings)

1. **The mailer can only email the team.** `mailer.send(subject, body)` has no recipient argument: it always sends to `FEEDBACK_EMAIL`. `mailer.enabled()` returns False unless `FEEDBACK_EMAIL` is set. Login codes need a new `send_to(to, subject, body)` that does not depend on `FEEDBACK_EMAIL` (Phase 3).
   **Status:** fixed in Phase 3 (`mailer.send_to`).
2. **pytest was not installed.** The tests are written with unittest. Fixed in Phase 0: pytest is now a uv dev dependency (`[dependency-groups] dev`). It is not in `requirements.txt`, so Vercel does not install it. `uv run pytest` collects the existing unittest tests.
   **Status:** fixed in Phase 0.
3. **`truevalue-user-v2` holds more than weights and budget.** `saveUser` stores the whole demo profile from `userProfiles.json`: `user_id`, `home_location`, `budget_sensitivity`, `budget_cad` and `weights`. Account preferences (Phase 4) should only sync `weights` and `budget_cad`.
   **Status:** handled in Phase 4. `preferencesSync.js` sends and applies only those two.
4. **`verified_percent` is backend-only**, as described in section 4.
   **Status:** unchanged by design. Scoring was not touched.
5. **Broken links.** `result.js` links to `/#scanner` (the message screen and the scan icon) and `chat.js` links to `/#products`. Neither anchor exists; the finder's id is `#find`. The result page's "＋ Compare" button sends people to `/#compare`.
   **Status:** fixed in Phase 1. Links go to `/#find`, and Compare goes to `/compare.html`.
6. **`frontend/public/` does not exist yet.** Phase 2 creates it for team photos.
   **Status:** created in Phase 2 (`public/team/`).
7. **`docs/design-reference/` does not exist**, so Phase 1 follows the written design rules.
   **Status:** Phase 1 followed the written rules (`styles/tokens.css`).
8. **Three separate styling systems.** `styles.css` and `chat.css` hard-code greens (#167d4a and others). `result.css` has its own `--r-*` variables and its own layout (a 440px phone frame). There are no shared tokens.
   **Status:** fixed in Phase 1. Every stylesheet uses `tokens.css`, and the `--r-*` variables are gone.
9. **Headers differ between pages.** `main.js` and `chat.js` each render their own header and nav, with different links. `result.js` has its own small top bar.
   **Status:** fixed in Phase 1. Every page uses `components/shell.js`.
10. **Smaller things:**
    - `zxing-wasm` is pinned to `"latest"` in `package.json` (the lockfile does fix the version).
    - `frontend/schema.sql` is unused.
    - `.gitignore` contains a stray `EOF` line and duplicate entries.
    - `GET /api/feedback` is public and returns every message.

    **Status:**
    - `zxing-wasm` is pinned to `3.1.5`.
    - `schema.sql` is removed.
    - The stray `EOF` line in `.gitignore` is gone. The duplicate entries are still there; they are harmless.
    - `GET /api/feedback` is admin-only since Phase 3.

## 6. Risks for the later phases (Phase 0 findings)

**Backend and auth (Phases 3 to 5)**
- **Tests against the real database.** `database.py` builds the engine at import time from `settings`, which reads `backend/.env`. Auth tests must never touch Neon.
  **Status:** handled. `test_auth.py` builds its own in-memory SQLite engine, overrides `get_db`, and patches settings, the mailer, Redis and Cloudinary.
- **Missing tables after a failed start.** `create_all` sits inside a try/except that only logs. If Neon is unreachable on a cold start, the new auth tables may not exist yet.
  **Status:** still open. Account endpoints would answer 500 until the next cold start creates the tables. Without `JWT_SECRET` they answer a clear 503.
- **No migrations.** `create_all` creates missing tables but never changes existing ones. Later column changes need manual SQL in Neon.
  **Status:** still true. The account tables were created once, as designed.
- **Time zones.** SQLite drops time zone information, and Postgres keeps it.
  **Status:** handled. Columns are `DateTime(timezone=True)`, and `as_utc` normalises before comparing.
- **Rate limits fail open.** `hit_rate_limit` returns "not limited" when Redis is missing or down.
  **Status:** handled. The per-email code limit is also counted in the database. The verify limit per IP uses `x-forwarded-for`.
- **Email speed and quota.** SMTP takes about 1 to 3 s per code. Gmail allows roughly 500 messages a day.
  **Status:** still true. Request-code fails with a clear error if SMTP is not configured.
- **Upload size and blocking calls.** Vercel rejects bodies over 4.5 MB, and the Cloudinary SDK is synchronous.
  **Status:** handled. The server caps uploads at 4 MB, the browser resizes to 512 px, and Cloudinary runs in `asyncio.to_thread`.
  A later finding: the SDK raises on import if `CLOUDINARY_URL` in the environment is malformed. That crashed the deployed API once, and it is now imported lazily.
- **Tokens in localStorage make XSS worse.** `ScoreExplanation.js` inserted names without escaping.
  **Status:** handled. That component is gone, the evidence on the result page uses `esc()`, and so do all usernames, emails and avatar URLs.
- **CORS.** `allow_headers=["*"]` already allows `Authorization`, and Bearer tokens do not need `credentials: 'include'`.
  **Status:** no change needed.

**Frontend (Phases 1, 2, 4, 5)**
- **Several separate pages.** The shell, the auth state and the preference sync must be modules every entry script imports.
  **Status:** done. `mountShell()` mounts the account card and runs `checkSession()` on every page. Sign-in in another tab arrives through the `storage` event.
- **Splitting `main.js`.**
  **Status:** done in Phase 1. Compare buttons are in `components/compare.js`, and the comparison is on `compare.html`.
- **One render path for the sliders.**
  **Status:** done in Phase 4. Loading saved values redraws Home with them.
- **Removing "Type barcode".**
  **Status:** removed in Phase 1. Scan, upload and search still work, and `/api/barcode` stays.

## 7. Accounts (Phases 3 to 5)

Passwordless sign-in. The server logic lives in `backend/app/services/auth.py`, with the endpoints in `routers/auth.py` and `routers/me.py`. The browser side lives in `frontend/src/services/session.js`, `auth.js`, `preferencesSync.js` and `profile.js`, and in `components/account.js`.

**Sign-in endpoints**
1. `POST /api/auth/request-code {email, username, mode}`: emails a 6-digit code using `mailer.send_to`. `mode` is `signin` (account must exist) or `signup` (email must be new, username required); without it, the username is needed only for a new email.
2. `POST /api/auth/verify-code {email, code, username?}`: checks the code, creates the user if they are new, and returns `{access_token, refresh_token, user}`.
3. The access token (JWT HS256, `ACCESS_TOKEN_MINUTES`) goes in `Authorization: Bearer` for `/api/me/*`. When it expires, `POST /api/auth/refresh {refresh_token}` returns a new pair and revokes the old refresh token (rotation). Reusing a revoked refresh token revokes all of that user's sessions.
4. `POST /api/auth/logout {refresh_token}` revokes it.

**Profile endpoints** (all need the access token)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/me` | | id, email, username, avatar_url, preferences |
| PATCH | `/api/me` | `{username}` | Same username rules as sign-in |
| PUT | `/api/me/preferences` | `{weights, budget_cad}` | Known dimension ids only, each 0 to 100; budget 0 to 10,000 |
| POST | `/api/me/avatar` | multipart `file` | JPEG, PNG or WebP (bytes checked), at most 4 MB. 503 without a valid `CLOUDINARY_URL` |
| DELETE | `/api/me/avatar` | | Also deletes the picture from Cloudinary |
| POST | `/api/me/email/request` | `{new_email}` | 409 "That email is already used by another account." |
| POST | `/api/me/email/confirm` | `{new_email, code}` | Checks again for a duplicate, then updates the email |

**Tables**, created by `create_all`:
- `users`: id, email (unique, lowercase), username, avatar_url, avatar_public_id, preferences, timestamps.
- `email_codes`: only an HMAC-SHA256 of the code, keyed with `JWT_SECRET`. Each code has a purpose (`login` or `change_email`), an expiry, an attempts count (at most 5) and `used_at`.
- `refresh_tokens`: jti, user_id, expires_at, revoked_at.

**Limits**
- 1 code per email per minute and 5 per hour, in Redis and also counted in the database, so the limit holds without Redis.
- 10 verify attempts per IP per 10 minutes, in Redis.

**Settings**
- `JWT_SECRET`: without it, the auth and `/me` endpoints answer 503 and the rest of the app works.
- `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS` and `LOGIN_CODE_MINUTES`.
- `CLOUDINARY_URL`: the value only, `cloudinary://<api_key>:<api_secret>@<cloud_name>`. A malformed value turns pictures off with a startup warning.
- `ADMIN_EMAILS`: the signed-in users who may read `GET /api/feedback`. Everyone else gets 401 or 403. Sending feedback stays open.

**Browser side**
- **`session.js`:** keeps `{access_token, refresh_token, user}` in localStorage under `truevalue-auth-v1`. On load it drops a session whose refresh token has already expired, so a page never starts signed in with a dead session.
- **401 handling in `api.js`:** a 401 triggers one shared refresh (`refreshOnce`), then a single retry. A rejected refresh signs out locally; being offline does not.
- **The account card** (`components/account.js`, a centred popup card from `shell.js`) shows the sign-in screens when signed out and the profile when signed in. While the card is open, a change redraws only the screen that made it, so an open edit is never wiped.

### Token storage note

Today the frontend and backend run on different Vercel domains, and that sets how the tokens are stored. Sharing httpOnly cookies across sites needs `SameSite=None; Secure`, which Safari often blocks. So the access token travels in the `Authorization: Bearer` header and the refresh token in the request body, and the frontend keeps both in localStorage. If the API is later served from `api.mytruevalue.net` (same site as `mytruevalue.net`), we could move the refresh token into an httpOnly, `SameSite=Lax` cookie.
