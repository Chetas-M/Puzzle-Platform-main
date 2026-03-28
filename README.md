# Puzzle Event Platform

Puzzle platform monorepo with the current production stack:

- API: apps/api (Express + Prisma)
- Web: apps/web (React + Vite)
- Contracts: packages/contracts

The legacy backend folder server/ has been removed.

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Configure environment variables

Copy .env.example to .env and set values for DATABASE_URL, SESSION_SECRET, and WEB_ORIGIN.

Optional tuning values:

- LEADERBOARD_CACHE_TTL_MS (default 3000) caches leaderboard responses briefly to reduce DB load.

3. Run API

```bash
npm run dev:api
```

API runs on http://localhost:4100 by default.

4. Run Web (new terminal)

```bash
npm run dev:web
```

Web runs on http://localhost:5174 by default and calls the API using VITE_API_BASE_URL.

## Useful Scripts

- npm run dev:api
- npm run dev:web
- npm run test:new
- npm run build:new

API package script:

- npm run loadtest -w apps/api -- --users 40 --rounds 20 --delayMs 250

This load test simulates logged-in participant traffic across key endpoints:

- /event/state
- /progress
- /puzzles
- /clipboard
- /leaderboard

## Puzzle Bank

The active puzzle bank used by the API is in apps/api/puzzle_bank.
