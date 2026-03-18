# AI Auction Arena Bot

Telegram-native AI auction MVP for the TON AI Agent Hackathon.

It generates collectible lots with OpenAI, simulates live AI bidders, accepts user bids, stores everything in SQLite, and is ready for TON MCP integration later without Docker, Redis, BullMQ, or any heavy infrastructure.

## What it does

- Generates a new auction lot with OpenAI
- Runs a live auction in Telegram
- Simulates multiple AI bidder personalities
- Accepts user bids with TON-ready payment abstraction
- Persists auctions, bids, and leaderboard in SQLite
- Starts with plain npm commands

## Stack

- Node.js
- TypeScript
- Grammy
- OpenAI API
- SQLite via better-sqlite3

## Quick start

1. Install dependencies

```bash
npm install
```

2. Copy environment file

```bash
cp .env.example .env
```

3. Fill in at least these values in `.env`

```env
BOT_TOKEN=...
OPENAI_API_KEY=...
```

4. Initialize the database

```bash
npm run db:init
```

5. Start the bot in development mode

```bash
npm run dev
```

For production build:

```bash
npm run build
npm start
```

## Telegram commands

- `/start` — intro and commands
- `/help` — quick guide
- `/newauction` — starts a new auction if none is live
- `/status` — current auction snapshot
- `/bid 0.20` — place a bid
- `/leaderboard` — top human bidders

## Environment variables

See `.env.example`.

Important ones:

- `BOT_TOKEN` — Telegram bot token
- `OPENAI_API_KEY` — OpenAI API key
- `OPENAI_MODEL` — defaults to `gpt-4o-mini`
- `DATABASE_PATH` — SQLite file path
- `AUCTION_DURATION_SEC` — auction length
- `AUCTION_TICK_SEC` — how often AI evaluates bids
- `MIN_BID_STEP` — minimum bid increment
- `TON_MODE` — `mock` or `mcp`
- `USE_OPENAI_FOR_BANTER` — AI banter on/off
- `USE_OPENAI_FOR_LOTS` — AI lot generation on/off

## TON integration

This MVP includes a clean TON service boundary in `src/services/ton/ton.service.ts`.

Current modes:

- `mock` — instant fake transfer confirmation for demo flow
- `mcp` — placeholder mode prepared for real `@ton/mcp` calls

That gives you a working demo now, while keeping the architecture hackathon-friendly for a final TON pass.

## Project structure

```text
src/
  bot/
    bot.ts
    handlers/
      auction.handler.ts
      bid.handler.ts
  config/
    env.ts
  db/
    db.ts
  services/
    ai/
      ai.service.ts
    auction/
      auction.service.ts
      auction.types.ts
    ton/
      ton.service.ts
  index.ts
scripts/
  init-db.ts
```

## Demo script for judges

1. Run `/newauction`
2. Show the generated lot
3. Wait for AI bids to appear live
4. Place `/bid 0.20`
5. Show the TX hash and updated status
6. Wait for the auction to end
7. Open `/leaderboard`

## Notes

- One live auction at a time by design for simplicity
- AI bidders are intentionally lightweight so the product feels alive without complex orchestration
- SQLite keeps setup trivial and local
- No Docker required

## Next upgrades after MVP

- Inline keyboard bidding buttons
- Real TON wallet confirmation flow
- Real `@ton/mcp` balance and transfer calls
- Generated preview images for each lot
- Public web dashboard for auction history
