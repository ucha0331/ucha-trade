# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**デイトレ羅針盤 (Day Trade Navigator)** — A web-based educational platform for beginner day traders to learn technical analysis using real Japanese stock market (TSE) data. Features candlestick charts, technical indicators (RSI, MACD, ADX), AI-powered commentary via Claude, and a trading journal backed by Supabase.

## Local Development

No build step required — the frontend is a single static HTML file. To run locally:

```bash
npm install           # installs yahoo-finance2 for local API testing
npx vercel dev        # runs Vercel dev server with serverless functions at localhost:3000
```

Without `vercel dev`, the `/api/*` routes won't work. The HTML alone can be opened in a browser but API calls will fail.

## Deployment

Deployed on Vercel. Push to the connected branch to trigger automatic deployment. No manual build commands needed.

Required Vercel environment variable:
- `ANTHROPIC_API_KEY` — Claude API key for `/api/ai-comment.js`

Supabase credentials (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) are embedded directly in `index.html` (safe for public anon keys).

## Architecture

**Frontend-dominant SPA with thin serverless proxy layer:**

- `index.html` — Single 2400+ line file containing all HTML, CSS, and JavaScript. No framework, no bundler. All technical indicator calculations, chart rendering (Canvas API), and UI logic live here.
- `api/` — Vercel serverless functions that proxy external APIs:
  - `stock-data.js` — Fetches 180 days of daily OHLC data from Yahoo Finance (`yahoo-finance2`) for TSE stocks (appends `.T` suffix to stock codes internally)
  - `ai-comment.js` — Proxies `prompt` + `maxTokens` to the Claude API
  - `search-symbol.js` — Searches stock codes/company names
  - `ranking.js` — Returns top 5 gainers/losers from 30 major stocks
- `lib/jp-names.js` — Large lookup object mapping 4-digit TSE stock codes to Japanese company names

**Two main UI tabs:**
1. チャート分析 (Chart Analysis) — symbol picker, candlestick + SMA overlay chart, RSI/MACD sub-charts, signal badge, AI commentary
2. 取引日記 (Trading Journal) — Google OAuth login (Supabase Auth), trade entry/exit logging, P&L tracking, watchlist, market rankings, AI pattern analysis

**Database (Supabase):** `trades` table stores per-user trade records. Auth uses Google OAuth via Supabase.

## Signal Logic

`computeSignal(data)` in `index.html` combines four indicators into a score:
- SMA golden/dead cross: ±2 points
- RSI overbought/oversold: ±1 point
- MACD crossover: ±1 point
- Price-MACD divergence: ±1 point

ADX filters for trend strength; volume spikes are detected separately. Score ≥2 → Buy, ≤-2 → Sell, else Hold.

## Key Constraints

- All AI commentary must frame analysis as "situation description for learning" and must not constitute investment advice.
- Market status distinguishes "confirmed" (previous close, market closed) from "live" (intraday provisional) prices — handle this distinction when modifying `stock-data.js`.
- Stock codes are 4-digit TSE codes in the UI; the `.T` suffix is added internally when calling Yahoo Finance.
