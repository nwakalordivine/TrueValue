# TrueValue architecture

This map describes the code as it was on the `dev` branch at commit `b92b055` (Phase 0 of the v2 work). Later phases update it.

## 1. The big picture

```
Browser (Vite multi-page app, plain JS)
  index.html  -> src/main.js     (values, finder, compare, evidence, near me, feedback)
  result.html -> src/result.js   (one product: score, reasons, alternatives)
  chat.html   -> src/chat.js     (assistant)
        |
        |  every call goes through src/api.js  (base URL = VITE_API_URL)
        v
FastAPI on Vercel (backend/app/main.py exposes `app`, routers mounted under /api)
        |
        +-- Neon Postgres (SQLAlchemy async + asyncpg): demo catalog, feedback, Corporations Canada registry
        +-- Redis (optional, fail-soft): response cache and rate limits
        +-- Open Food Facts: real products by barcode and by name
        +-- OpenStreetMap: Overpass (stores, drop-offs) with Nominatim as backup
        +-- OpenRouter (optional): AI parsing and wording for the assistant
        +-- Gmail SMTP: feedback emails
```

The browser computes nothing it has to trust. The backend recomputes the score for every request, and it never stores a score.

## 2. Folder map

### Backend (`backend/`)

| Path | What it does |
|---|---|
| `app/main.py` | Creates the FastAPI app. On startup (`lifespan`) it enables `pg_trgm` on Postgres, runs `Base.metadata.create_all`, seeds the demo catalog if the tables are empty, then loads the catalog into memory. If any of this fails it logs the error and serves from the JSON files instead. It also sets up CORS from `CORS_ORIGINS`, mounts every router under `/api`, and defines `/api/health`. |
| `app/config.py` | `Settings` (pydantic-settings). Reads environment variables, then `backend/.env`. Real environment variables win over `.env`. |
| `app/database.py` | Builds the async engine **when the module is imported**, using `settings.DATABASE_URL`, plus `SessionLocal` and `get_db`. The default URL is a local SQLite file (`sqlite+aiosqlite`). |
| `app/models.py` | Tables. Catalog tables keep their key columns as real columns and store the full record in a JSON `data` column, so the API returns exactly the shape of the JSON files. Also defines `Feedback` and `Corporation` (the federal registry). `CATALOG_TABLES` maps each JSON file to its model. |
| `app/schemas.py` | Pydantic request bodies: `WeightsIn`, `ChatIn`, `Location`, `FeedbackIn`. |
| `app/redis_client.py` | `cache_get`, `cache_set`, `hit_rate_limit`, `ping`. With no `REDIS_URL`, or when Redis errors, they return None/False, so a request is **never blocked** by Redis. Rate limits therefore fail open. |
| `app/routers/catalog.py` | `GET /catalog`, `POST /products/{id}/card`, `GET /products/{id}/disposal`, `POST /barcode`, `GET /search`. |
| `app/routers/chat.py` | `POST /chat`: rate limited per IP (`x-forwarded-for`), with a hard 45 s answer budget because Vercel stops functions at 60 s. |
| `app/routers/companies.py` | `GET /companies/search`, `GET /companies/{number}`: the Corporations Canada registry. |
| `app/routers/places.py` | `GET /places/stores`, `GET /places/drop-offs`. |
| `app/routers/feedback.py` | `POST /feedback` saves to the DB, then emails. `GET /feedback` lists recent feedback. |
| `app/routers/diagnostics.py` | `GET /diagnostics` times every outside service from inside Vercel. |
| `app/services/scoring.py` | The scoring model (pure Python). Ported from the frontend and kept identical. |
| `app/services/assistant.py` | Builds the True Value Card (`product_card`), handles barcode lookup (`lookup_barcode`), and holds the chat handlers and the AI summary guard. |
| `app/services/parser.py` | Rule-based intent parser, plus `merge_llm`, which keeps the AI from inventing products or dimensions. |
| `app/services/llm.py` | OpenRouter client: primary then fallback model, inside a strict time budget. Returns None on any failure. |
| `app/services/openfoodfacts.py` | `fetch` (barcode), `search` (by name), and `to_truevalue`, which turns OFF label data into TrueValue claims. |
| `app/services/places.py` | Overpass mirrors (fastest first), with Nominatim as fallback. Results are cached by rounded location. |
| `app/services/registry.py` | Trigram search over the `corporations` table. |
| `app/services/disposal.py` | City of Regina bin rules: blue cart, SARCAN, SARCAN refund, garbage, check. |
| `app/services/catalog.py` | Seeds the DB from `backend/data/*.json` and keeps the catalog in memory, falling back to the JSON files. |
| `app/services/mailer.py` | SMTP over STARTTLS (Gmail App Password), run in a thread. Only sends to `FEEDBACK_EMAIL`. |
| `data/*.json` | Demo catalog: products, companies, claims, certifications, prices, retailers, dimensions, default weights. |
| `scripts/seed.py`, `scripts/import_corporations.py` | Reload the demo catalog, and import the Corporations Canada CSV with Postgres COPY. |
| `tests/test_logic.py` | unittest tests for scoring, the parser and disposal. They need no DB or network, and pytest runs them. |
| `pyproject.toml` + `uv.lock` | Local dependencies (uv). pytest is a dev-only dependency. |
| `requirements.txt` | What Vercel installs. Must list every runtime dependency. |
| `vercel.json` | `maxDuration` 60 s for `app/main.py`. |

### Frontend (`frontend/`)

| Path | What it does |
|---|---|
| `index.html`, `result.html`, `chat.html` | Empty `#app` shells. Each loads one script. All three are registered as inputs in `vite.config.js`. |
| `src/main.js` | Renders the whole home page as one template: hero, values sliders plus budget, the finder with four tabs (Scan, Upload, Type barcode, Search), demo products, compare, evidence, Near me, feedback, footer and the floating chat button. It loads `/api/catalog`, or falls back to the bundled JSON. |
| `src/result.js` + `result.css` | Result page. Has its own phone-first design and its own `--r-*` CSS variables. |
| `src/chat.js` + `chat.css` | Assistant page, with a camera or photo barcode button. |
| `src/api.js` | The only place that calls the backend: a `request()` helper with a timeout and friendly errors. |
| `src/components/views.js` | Shared HTML builders: `esc`, `money`, `statusBadge`, `verdictPill`, `placeList`, `disposalView`, `locationLine`, `scanResultView`. |
| `src/components/ScoreExplanation.js` | Evidence panel for a demo product (ownership chain, certifications, breakdown table). |
| `src/services/scoringService.js` | Frontend copy of the scoring model (used for demo cards and offline mode). |
| `src/services/customerValuesService.js` | `loadUser` and `saveUser` in localStorage, key `truevalue-user-v2`. |
| `src/services/compareTray.js` | Up to 3 items to compare, in localStorage, key `truevalue-compare-v1`. |
| `src/services/barcodeScanner.js` | zxing-wasm camera and photo decoding, loaded lazily. |
| `src/services/locationService.js` | Browser geolocation, cached per session, falling back to downtown Regina. Also builds the OSM embed URL. |
| `src/services/recommendationService.js`, `provenanceService.js`, `feedbackService.js` | Offline alternatives, provenance labels, and offline feedback saved to localStorage. |
| `src/data/*.json` | Offline copies of the demo catalog (byte-identical to `backend/data`). |
| `tests/scoring.test.js` | `node --test` tests for the frontend scoring. |
| `schema.sql` | An old SQLite schema. Nothing uses it. |

## 3. How a request flows

**Page load (home).** `main.js` calls `GET /api/catalog`. The backend answers from the in-memory catalog, which was loaded from Neon at startup or from the JSON files. If the call fails, the page uses `src/data/*.json` and says "Offline mode".

**Scan or upload a barcode.**
1. zxing-wasm decodes the barcode in the browser.
2. The browser goes to `/result.html?barcode=...`.
3. `result.js` calls `POST /api/barcode` with the saved weights.
4. `assistant.lookup_barcode` checks the demo catalog first. If the barcode is not there, it calls `openfoodfacts.fetch`: Redis cache first (24 h), then `world.openfoodfacts.org/api/v2/product/{code}.json`.
5. `to_truevalue` turns the label data into six Claimed or Unknown claims, `product_card` scores them, and `registry.search_companies` looks up the brand owner in Neon.

**Search by name.** `GET /api/search` returns matching demo products, then `openfoodfacts.search`: Redis cache first (6 h), then `search.openfoodfacts.org` filtered to Canada, then worldwide, then the old `cgi/search.pl` as a last resort.

**Near me.** `GET /api/places/stores` or `/drop-offs` goes to `places.py`: Redis cache first (6 h), then the Overpass mirrors in order within a 14 s budget, then Nominatim within an 8 s budget. The response gives distances and OSM directions links. Stock is always shown as Unknown.

**Assistant.**
1. `POST /api/chat` checks the per-IP rate limit (Redis).
2. `parser.rule_parse` works out the intent.
3. If an OpenRouter key is set, `llm.complete_json` refines the parse, cached in Redis for 1 h. `merge_llm` throws away any invented product or dimension.
4. The handler for the intent runs (recommend, compare, explain, where to buy, dispose, company check, barcode, help).
5. Optionally, the AI rewords the template answer. `_summarize` rejects any answer that names a product not in the results.

**Feedback.** `POST /api/feedback` saves a `Feedback` row in Neon, then `mailer.send` emails `FEEDBACK_EMAIL` over SMTP. If the server is down, the browser saves the feedback in localStorage instead.

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
- Demo product cards on the home page use the frontend `calculateMatch`.
- The verdict panel, compare, the result page and the assistant use the backend card (`/products/{id}/card`, `/barcode`, `/chat`).
- `backend/tests/test_logic.py::test_matches_frontend_for_prairie_morning` pins Prairie Morning Coffee at 74/100 with 91% coverage under the default weights.

## 5. Where the v2 brief does not match the code

1. **The mailer can only email the team.** `mailer.send(subject, body)` has no recipient argument: it always sends to `FEEDBACK_EMAIL`. `mailer.enabled()` returns False unless `FEEDBACK_EMAIL` is set. Login codes need a new `send_to(to, subject, body)` that does not depend on `FEEDBACK_EMAIL` (Phase 3).
2. **pytest was not installed.** The tests are written with unittest. Fixed in Phase 0: pytest is now a uv dev dependency (`[dependency-groups] dev`). It is not in `requirements.txt`, so Vercel does not install it. `uv run pytest` collects the existing unittest tests.
3. **`truevalue-user-v2` holds more than weights and budget.** `saveUser` stores the whole demo profile from `userProfiles.json`: `user_id`, `home_location`, `budget_sensitivity`, `budget_cad` and `weights`. Account preferences (Phase 4) should only sync `weights` and `budget_cad`.
4. **`verified_percent` is backend-only**, as described in section 4.
5. **Broken links.** `result.js` links to `/#scanner` (the message screen and the scan icon) and `chat.js` links to `/#products`. Neither anchor exists; the finder's id is `#find`. The result page's "＋ Compare" button sends people to `/#compare`.
6. **`frontend/public/` does not exist yet.** Phase 2 creates it for team photos.
7. **`docs/design-reference/` does not exist**, so Phase 1 follows the written design rules.
8. **Three separate styling systems.** `styles.css` and `chat.css` hard-code greens (#167d4a and others). `result.css` has its own `--r-*` variables and its own layout (a 440px phone frame). There are no shared tokens.
9. **Headers differ between pages.** `main.js` and `chat.js` each render their own header and nav, with different links. `result.js` has its own small top bar.
10. **Smaller things:**
    - `zxing-wasm` is pinned to `"latest"` in `package.json` (the lockfile does fix the version).
    - `frontend/schema.sql` is unused.
    - `.gitignore` contains a stray `EOF` line and duplicate entries.
    - `GET /api/feedback` is public and returns every message.

Everything else in section 1 of the brief matches the code: the pages, the services, the localStorage key, `api.js` as the only backend caller, zxing-wasm, the FastAPI async stack, `create_all` without Alembic, Redis helpers with `hit_rate_limit`, and CORS from `CORS_ORIGINS`.

## 6. Risks for the next phases

**Backend and auth (Phases 3 to 5)**
- **Tests against the real database.** `database.py` builds the engine at import time from `settings`, which reads `backend/.env`. Auth tests must set `DATABASE_URL` (a temporary SQLite file), `JWT_SECRET` and similar values as **environment variables before importing `app`**. Environment variables win over `.env`, so tests can never touch Neon. Do this in `tests/conftest.py`.
- **Missing tables after a failed start.** `create_all` sits inside a try/except that only logs. If Neon is unreachable on a cold start, the new auth tables may not exist yet. Auth endpoints should answer with a clear 503, not a 500.
- **No migrations.** `create_all` creates missing tables but never changes existing ones. Get the `users` columns right the first time. Later column changes need manual SQL in Neon.
- **Time zones.** SQLite (used in tests) drops time zone information, and Postgres keeps it. Store UTC with `DateTime(timezone=True)` and normalise before comparing. Get "now" from one helper so tests can move the clock to check expiry.
- **Rate limits fail open.** `hit_rate_limit` returns "not limited" when Redis is missing or down. That is why the per-email code limit also needs a database count. The client IP comes from `x-forwarded-for` (set by Vercel).
- **Email speed and quota.** SMTP takes about 1 to 3 s per code (it runs in a thread). Gmail allows roughly 500 messages a day. If SMTP is not configured, request-code must fail clearly instead of pretending to send.
- **Upload size and blocking calls.** Vercel rejects bodies over 4.5 MB, so cap avatars at 4 MB on the server and resize them in the browser. The Cloudinary SDK is synchronous, so call it with `asyncio.to_thread`.
- **Tokens in localStorage make XSS worse.** Most templates escape with `esc()`, but `ScoreExplanation.js` inserts product, company, certification and source names without escaping. Fix it when the evidence section moves in Phase 1, and keep using `esc()` for every user-controlled value (usernames, emails, avatar URLs).
- **CORS.** `allow_headers=["*"]` already allows `Authorization`. Bearer tokens do not need `credentials: 'include'`. `allow_credentials` is on whenever the origin list is not `*`, which is harmless.

**Frontend (Phases 1, 2, 4, 5)**
- **Several separate pages.** There are three pages today and five after Phase 1, each a separate document. The shell, the auth state and the preference sync must be modules that every entry script imports. Login state crosses pages and tabs through localStorage and the `storage` event.
- **Splitting `main.js`.** Compare rendering, `compareButton` and the evidence panel all live inside `main.js` and depend on its `state`. Moving compare to `compare.html` means pulling `compareButton` and the card fetch into shared modules, and pointing the result page's compare button at `/compare.html`.
- **One render path for the sliders.** `main.js` keeps the weights in `state.user` and saves them with `saveUser`. The result page, chat and compare read them once at load. Phase 4's "Loaded your saved values" has to update the sliders and re-render, so values must have a single place that renders them.
- **Removing "Type barcode".** It shares `#scannerStatus` and the tab-switching code with the other modes. Remove it carefully so scan, upload and search keep working. The chat page still accepts a pasted barcode, and `/api/barcode` stays.

## 7. Authentication (Phase 3)

Passwordless sign-in. The logic lives in `backend/app/services/auth.py`, and the endpoints are in `routers/auth.py` and `routers/me.py`.

1. `POST /api/auth/request-code {email, username}`: emails a 6-digit code using `mailer.send_to`. The username is needed only for a new email.
2. `POST /api/auth/verify-code {email, code, username?}`: checks the code, creates the user if they are new, and returns `{access_token, refresh_token, user}`.
3. The access token (JWT HS256, `ACCESS_TOKEN_MINUTES`) goes in `Authorization: Bearer` for `/api/me/*`. When it expires, `POST /api/auth/refresh {refresh_token}` returns a new pair and revokes the old refresh token (rotation). Reusing a revoked refresh token revokes all of that user's sessions.
4. `POST /api/auth/logout {refresh_token}` revokes it.

New tables, created by `create_all`:
- `users`: id, email (unique, lowercase), username, avatar_url, avatar_public_id, preferences, timestamps.
- `email_codes`: only an HMAC-SHA256 of the code, keyed with `JWT_SECRET`. Each code has an expiry, an attempts count (at most 5) and `used_at`.
- `refresh_tokens`: jti, user_id, expires_at, revoked_at.

Limits:
- 1 code per email per minute and 5 per hour, in Redis and also counted in the database, so the limit holds without Redis.
- 10 verify attempts per IP per 10 minutes, in Redis.

New settings:
- `JWT_SECRET`: without it, the auth and `/me` endpoints answer 503 and the rest of the app works.
- `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS` and `LOGIN_CODE_MINUTES`.
- `CLOUDINARY_URL`, for profile pictures.
- `ADMIN_EMAILS`: the signed-in users who may read `GET /api/feedback`. Everyone else gets 401 or 403. Sending feedback stays open.

### Token storage note

Today the frontend and backend run on different Vercel domains, and that sets how the tokens are stored. Sharing httpOnly cookies across sites needs `SameSite=None; Secure`, which Safari often blocks. So the access token travels in the `Authorization: Bearer` header and the refresh token in the request body, and the frontend keeps both in localStorage. If the API is later served from `api.mytruevalue.net` (same site as `mytruevalue.net`), we could move the refresh token into an httpOnly, `SameSite=Lax` cookie.
