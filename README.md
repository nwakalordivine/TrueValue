# TrueValue: Ethical Consumer Compass

Tech Skills Showcase 2026 (Regina Open Door Society). Shop by your values. Trust the evidence.

Live at https://mytruevalue.net.

```
TrueValue/
  backend/    FastAPI + Neon Postgres + Redis + OpenRouter + Cloudinary, deployed on Vercel
  frontend/   Vite multi-page web app (plain JavaScript), deployed on Vercel
    index.html    Home: your values, find a product (scan, photo, search), demo products, feedback, About
    result.html   One product: score, why, consider instead, evidence, where to buy, disposal
    chat.html     Assistant
    compare.html  Side-by-side comparison of up to 3 products
    nearme.html   Real stores and recycling drop-offs near you
  docs/       ARCHITECTURE.md: how the code fits together
```

Every page shares one app shell (`frontend/src/components/shell.js`):
- **Phones:** a top bar with the account avatar on the left and a menu button that slides the sidebar in from the right.
- **Desktop (1024px and up):** a fixed left sidebar.

## Features

| Feature | Where | Data |
|---|---|---|
| Backend API serving the catalog, scores and True Value Card verdicts | `backend/app` | Demo catalog (12 products) stored in Postgres |
| **Your values**: sliders and a budget, saved in the browser, or to your account when signed in | Home | Browser or account |
| **Find a product**: scan a barcode with the camera, upload a photo of one, or search by name. Real products from Open Food Facts, popular ones sold in Canada first, scored against your values | Home, `POST /api/barcode`, `GET /api/search` | Real, Open Food Facts (marked Claimed) |
| **Result page**: score, why, consider instead, evidence and sources, nearest stores, which bin | `result.html?barcode=...` or `?product=p5` | All of the below |
| **Assistant**: recommend, compare, explain scores, company check, where to buy, how to dispose; camera and photo barcode buttons | `chat.html`, `backend/app/services/assistant.py` | All of the below |
| **Compare** up to 3 products side by side | `compare.html`, tray in `src/services/compareTray.js` | Computed |
| **Near me**: nearest stores and recycling drop-offs (SARCAN depots first), with distance and directions | `nearme.html` | Real, OpenStreetMap |
| **Which bin?** guidance per packaging material | Result page, assistant | Real City of Regina rules (July 2025 changes) |
| **Federal company check** ("Is Loblaw a Canadian company?") | Assistant, `GET /api/companies/search` | Real, Corporations Canada CSV |
| **Accounts**: passwordless sign-in with an emailed 6-digit code; values saved to the account | Account card (avatar or sidebar "Sign in") | Postgres |
| **Profile**: picture, username, email change, log out | Account card | Postgres, Cloudinary |
| **About** section with team cards | Bottom of Home | `src/data/team.json`, `public/team/` |
| **Report a problem**: feedback saved to the database and emailed to the team | Home (`/#feedback`), sidebar link | Postgres, SMTP |

Honesty rules built in:
- Products and their claims are fictional and labelled so.
- Unknown is never scored as zero.
- Federal registration is shown as proof of registration, never of Canadian ownership.
- Store stock is always Unknown.
- The AI only words answers from facts the code computed.

## Accounts and sign-in

Guests can use everything. Their values stay in this browser only (localStorage).

Signing in is passwordless:
1. Open the account card from the avatar or the sidebar's **Sign in**.
2. Enter your email, plus a username the first time.
3. Enter the 6-digit code sent to that email. It works once, expires in 10 minutes, and locks after 5 wrong tries.
4. You get an access token (1 hour) and a refresh token (7 days). The app refreshes the session by itself. If the refresh fails, it signs out locally.

Saved values:
- **At sign-in:** if the account has no saved values, the browser's current ones are uploaded. Otherwise the saved ones replace the local ones, with the notice "Loaded your saved values."
- **While signed in:** every slider or budget change saves to the account 800ms after the last change, and also to the browser so the page works offline.
- **Logging out** keeps the current values in the browser.

The profile in the account card covers:
- **Picture:** resized in the browser to 512px, then uploaded to Cloudinary. It can also be removed.
- **Username:** edited in place.
- **Email change:** with a code sent to the new address. An email that another account already uses is refused.
- **Log out.**

## Environment variables

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`, then fill them in. Never commit the `.env` files.

**Backend**

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres, `postgresql+asyncpg://...?ssl=require`. Without it, a local SQLite file is used. |
| `REDIS_URL` | Optional | Caching and rate limits. The app works without it. |
| `OPENROUTER_API_KEY`, `LLM_MODEL_PRIMARY`, `LLM_MODEL_FALLBACK` | Optional | AI wording for the assistant. Without a key it runs in rule-based mode. |
| `CORS_ORIGINS` | Yes | Comma separated frontend URLs allowed to call the API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Yes for sign-in | Sends sign-in codes and feedback emails. Gmail needs an App Password. |
| `FEEDBACK_EMAIL` | Optional | Where feedback is emailed. Empty means it is only saved in the database. |
| `JWT_SECRET` | Yes for sign-in | Signs the tokens and keys the code hashes. Without it, sign-in answers 503 and the rest of the app works. |
| `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `LOGIN_CODE_MINUTES` | Optional | Defaults 60, 7 and 10 |
| `CLOUDINARY_URL` | Optional | Profile pictures. The value only: `cloudinary://<api_key>:<api_secret>@<cloud_name>`. A malformed value turns pictures off and logs a warning. |
| `ADMIN_EMAILS` | Optional | Comma separated emails of signed-in users who may read `GET /api/feedback` |

Generate `JWT_SECRET` with:
```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Frontend**

| Variable | What it does |
|---|---|
| `VITE_API_URL` | Where the backend runs. Default `http://localhost:8000`. |

## 1. Backend setup (once)

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/).

1. Create `backend/.env` (see above).
2. Install and start:
   ```
   cd backend
   uv sync
   uv run uvicorn app.main:app --reload --port 8000
   ```
   On first start it creates all tables (catalog, feedback, users, email codes, refresh tokens) and seeds the demo catalog.
3. Check http://localhost:8000/api/health and the interactive docs at http://localhost:8000/docs.
4. Load the real company registry into Neon (once, about 1 to 3 minutes):
   ```
   uv run python -m scripts.import_corporations "C:\path\to\corporations-active-cbca-en.csv"
   ```
   It skips numbered companies like "8448566 CANADA INC." (useless for name search), loading about 395k named corporations. Add `--provinces SK,MB,AB` for a smaller import if Neon storage is tight.

Tests: `uv run pytest`. They use an in-memory SQLite database with the mailer, Redis and Cloudinary faked, so they never touch Neon or send email.

## 2. Frontend

```
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # scoring, team, sign-in and profile tests
npm run build    # production build in dist/
```

The frontend expects the API at `http://localhost:8000`. Set `VITE_API_URL` in `frontend/.env` to change it. If the backend is down, Home still works with bundled data (offline mode) and says so.

## 3. Deploy (Vercel)

Two Vercel projects from this repository:
- **Backend:** root directory `backend`. Vercel installs from `requirements.txt` and serves `app/main.py` (60s function limit in `vercel.json`).
- **Frontend:** root directory `frontend`, build `npm run build`, output `dist`. Custom domain `mytruevalue.net`.

Location only works on https (or localhost). Run the registry import from your laptop against Neon; it doesn't need to run on the server.

### Deployment checklist

1. **Backend environment variables** (Vercel backend project, Settings, Environment Variables). Add:
   - `JWT_SECRET` (generate it with the command above)
   - `ACCESS_TOKEN_MINUTES=60`
   - `REFRESH_TOKEN_DAYS=7`
   - `LOGIN_CODE_MINUTES=10`
   - `CLOUDINARY_URL`: the value only, starting with `cloudinary://`
   - `ADMIN_EMAILS`
2. **`CORS_ORIGINS`** includes `https://mytruevalue.net`, `https://www.mytruevalue.net`, the frontend's `*.vercel.app` address and `http://localhost:5173`.
3. **Mail:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` are set, because sign-in depends on email.
4. **Frontend:** `VITE_API_URL` in the Vercel frontend project points to the backend URL. Redeploy the frontend after changing it, because Vite builds it into the bundle.
5. **Tables:** the new tables are created automatically on the first start after deploying. Open `/api/health`, then sign in once on the live site to confirm email, tokens and saved values work.

## 4. Demo script (2 minutes)

1. Home: move the "Buy Canadian" slider and watch the demo products change. Open Everyday Ground Coffee:
   - the verdict says **Consider instead**
   - the evidence shows what is Verified, Claimed or Unknown
   - the nearest real stores are listed
   - it says which bin the pouch goes in (SARCAN, since flexible plastics left the blue cart in July 2025)
2. Find a product: scan any grocery item in the room with the camera, or upload a photo of its barcode. You get a real product with real label data, scored for your values.
3. Near me: allow location, and show the real stores and SARCAN depots with distances and directions.
4. Assistant: ask
   - "Canadian coffee under $15 with less plastic"
   - "Is Loblaw a Canadian company?" (real registry: registered in Toronto, ownership Unknown, and why)
   - "Compare Prairie Morning Coffee and Everyday Ground Coffee"
   - "How do I dispose of a glass jar?"
5. Sign in with an email and the 6-digit code, then open the site on a phone and sign in there: the same values load.
6. Close on the trust story: every fact is Verified, Claimed or Unknown, and we say exactly what each data source proves.

## API summary

All paths are under `/api`. "Token" means `Authorization: Bearer <access token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status: database, AI on/off, Redis, registry row count |
| GET | `/catalog` | All demo data (same shape as `frontend/src/data`) |
| POST | `/products/{id}/card` | True Value Card for given weights |
| GET | `/products/{id}/disposal` | Regina bin guidance for the packaging |
| POST | `/barcode` | Barcode lookup: `{barcode, weights}` |
| GET | `/search?q=&limit=` | Search real products by name in Open Food Facts (no demo products) |
| GET | `/places/stores?lat&lon&category` | Nearest real stores (OpenStreetMap) |
| GET | `/places/drop-offs?lat&lon` | Nearest SARCAN depots and recycling points |
| GET | `/companies/search?q=`, `/companies/{number}` | Federal registry search and detail |
| POST | `/chat` | Assistant: `{message, weights, location}` (a barcode as the message works too) |
| POST | `/feedback` | Send feedback (anyone) |
| GET | `/feedback` | Recent feedback (token, `ADMIN_EMAILS` only) |
| GET | `/diagnostics` | Times every outside service from the server |
| POST | `/auth/request-code` | `{email, username, mode}`: email a 6-digit code. `mode` `signin` needs an existing account (404 if none), `signup` needs a new email and a username (409 if the email is taken). |
| POST | `/auth/verify-code` | `{email, code, username?}` returns `{access_token, refresh_token, user}` |
| POST | `/auth/refresh` | `{refresh_token}` returns a new pair. The old refresh token stops working. |
| POST | `/auth/logout` | `{refresh_token}`: revokes it (204) |
| GET | `/me` | The signed-in user (token) |
| PATCH | `/me` | `{username}` (token) |
| PUT | `/me/preferences` | `{weights, budget_cad}` (token) |
| POST | `/me/avatar` | Multipart `file`: JPEG, PNG or WebP, at most 4 MB (token) |
| DELETE | `/me/avatar` | Remove the picture (token) |
| POST | `/me/email/request` | `{new_email}`: code to the new address. 409 if another account uses it. (token) |
| POST | `/me/email/confirm` | `{new_email, code}` returns the updated user (token) |

AI model: OpenRouter, set by `LLM_MODEL_PRIMARY` and `LLM_MODEL_FALLBACK`. The free tier is 50 requests a day per account unless $10 of credits was ever bought. Each chat uses up to 2. Answers are cached in Redis for an hour.
