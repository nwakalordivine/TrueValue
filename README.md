# TrueValue: Ethical Consumer Compass

Tech Skills Showcase 2026 (Regina Open Door Society). Shop by your values. Trust the evidence.

```
TrueValue/
  backend/    FastAPI + Neon Postgres + Redis + OpenRouter (replaces the old "Reserve" folder)
  frontend/   Vite web app: main page with inputs (index.html), result page (result.html), assistant (chat.html)
```

## What's new in this version

| Feature | Where | Data |
|---|---|---|
| Backend API serving the catalog, scores and True Value Card verdicts | `backend/app` | Demo catalog, now 12 products, stored in Postgres |
| **Assistant page** (chat): recommend, compare, explain scores, company check, where to buy, how to dispose | `frontend/chat.html`, `backend/app/services/assistant.py` | All of the below |
| **Automatic location** (browser asks once, falls back to downtown Regina) | `frontend/src/services/locationService.js` | Browser |
| **Nearest stores** that sell the product's category, with distance and directions | Near Me section, Evidence section, assistant | Real, OpenStreetMap |
| **Nearest recycling drop-offs** (SARCAN depots first) | Near Me section, assistant | Real, OpenStreetMap |
| **Which bin?** guidance per packaging material | Evidence section, assistant | Real City of Regina rules (July 2025 changes) |
| **Federal company check** ("Is Loblaw a Canadian company?") | Assistant, `GET /api/companies/search` | Real, Corporations Canada CSV |
| True Value Card verdict: Good fit / Consider instead / Buy with caution, plus "based on X% verified data" | Evidence section, assistant cards | Computed |
| **Barcode scanner**: camera, photo upload, or typed barcode. Demo catalog first, then real products from Open Food Facts, scored against your values with registry check and disposal guidance | Scan section (main page), 📷 and 🖼️ buttons in the assistant, `POST /api/barcode` | Real, Open Food Facts (marked Claimed) |
| **Result page**: one product per screen (score, why, consider instead, price vs category, nearest store, disposal). Opens after any scan, photo, typed barcode or "See result" | `frontend/result.html`, `result.html?barcode=...` or `?product=p5` | All of the above |
| Feedback saved to the database | Feedback section | Postgres |

Honesty rules built in: products and their claims are fictional and labelled so; unknown is never scored as zero; federal registration is shown as proof of registration, never of Canadian ownership; store stock is always Unknown; the AI only words answers from facts the code computed.

## 1. Backend setup (once)

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/) (you already use it).

1. Copy your existing `.env` from the old `Reserve` folder into `backend/.env`. It already has the right keys. Check:
   - `DATABASE_URL` starts with `postgresql+asyncpg://` and ends with `?ssl=require` (yours does)
   - `REDIS_URL` is set (yours is)
   - `OPENROUTER_API_KEY` is **empty in your file**. Paste your key from openrouter.ai/keys to turn on AI wording. Without it, the assistant still works in rule-based mode.
2. Install and start:
   ```
   cd backend
   uv sync
   uv run uvicorn app.main:app --reload --port 8000
   ```
   On first start it creates all tables in Neon and seeds the demo catalog automatically.
3. Check http://localhost:8000/api/health and the interactive docs at http://localhost:8000/docs
4. Load the real company registry into Neon (once, about 1 to 3 minutes):
   ```
   uv run python -m scripts.import_corporations "C:\path\to\corporations-active-cbca-en.csv"
   ```
   It skips numbered companies like "8448566 CANADA INC." (useless for name search), loading about 395k named corporations. Add `--provinces SK,MB,AB` for a smaller import if Neon storage is tight.

Tests (no database needed): `uv run python -m unittest discover -s tests`

## 2. Frontend

```
cd frontend
npm install
npm run dev
```
(`npm install` also installs `html5-qrcode`, the barcode reader. Rerun it after updating.)

Open http://localhost:5173. The assistant is at http://localhost:5173/chat.html (or the 💬 button).

The frontend expects the API at `http://localhost:8000`. To change it, copy `.env.example` to `.env` and set `VITE_API_URL`. If the backend is down, the main page still works with bundled data (offline mode) and says so.

## 3. Deploy

- **Backend: Render** (free web service). Root directory `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Add the same environment variables as your `.env`, and set `CORS_ORIGINS` to your frontend URL (comma-separate it with `http://localhost:5173`).
- **Frontend: Vercel or Netlify.** Root directory `frontend`, build `npm run build`, output `dist`. Set `VITE_API_URL` to your Render URL.
- Location only works on https (or localhost); both hosts give you https.
- Run the registry import from your laptop against Neon; you don't need to run it on the server.

## 4. Demo script (2 minutes)

1. Main page: move the "Buy Canadian" slider and watch rankings change. Click "Why this score?" on Everyday Ground Coffee: verdict says **Consider instead**, nearest real stores, and which bin the pouch goes in (SARCAN, since flexible plastics left the blue cart in July 2025).
2. Near Me: allow location, show real stores and SARCAN depots with distances and directions.
3. Assistant: ask
   - "Canadian coffee under $15 with less plastic"
   - "Is Loblaw a Canadian company?" (real registry: registered in Toronto, ownership Unknown, and why)
   - "Compare Prairie Morning Coffee and Everyday Ground Coffee"
   - "How do I dispose of a glass jar?"
   - Tap 📷 and scan any grocery item in the room (or upload a photo of its barcode): real product, real label data, scored for your values
4. Close on the trust story: every fact is Verified, Claimed or Unknown, and we say exactly what each data source proves.

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status: database, AI on/off, Redis, registry row count |
| GET | `/api/catalog` | All demo data (same shape as `frontend/src/data`) |
| POST | `/api/products/{id}/card` | True Value Card for given weights |
| GET | `/api/products/{id}/disposal` | Regina bin guidance for the packaging |
| GET | `/api/places/stores?lat&lon&category` | Nearest real stores (OpenStreetMap) |
| GET | `/api/places/drop-offs?lat&lon` | Nearest SARCAN depots and recycling points |
| GET | `/api/companies/search?q=` | Federal registry search |
| POST | `/api/chat` | Assistant: `{message, weights, location}` (a barcode as the message works too) |
| POST | `/api/barcode` | Barcode lookup: `{barcode, weights}` |
| POST | `/api/feedback` | Save feedback |

AI model: OpenRouter `nvidia/nemotron-3.5-lightning:free`, fallback `nvidia/nemotron-3-super-120b-a12b:free`. Free tier is 50 requests/day per account unless $10 of credits was ever bought; each chat uses up to 2. Answers are cached in Redis for an hour.
