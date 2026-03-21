# AI Auction Arena Bot

Telegram-native AI auction MVP for the TON AI Agent Hackathon.

It generates collectible lots with OpenAI, runs AI-vs-human bidding inside Telegram, stores everything in SQLite, and now includes a real TON payment flow for winners using a TON wallet deep link, with a clean upgrade path to `@ton/mcp`.

## What changed in this version

- AI bidders now decide rationally whether a lot is still worth bidding for
- Bid jumps scale with price, so bots stop making silly cent-level raises on huge amounts
- Leaderboard updates for both users and AI agents
- Winners receive a TON payment button and `/pay` invoice flow
- Bot commands are registered from code via `setMyCommands`, so they appear in Telegram's command menu without relying only on BotFather

## What it does

- Generates a new auction lot with OpenAI
- Gives each lot an AI-estimated fair value, reserve threshold, and hype score
- Runs a live auction in Telegram
- Uses OpenAI to help AI bidders decide whether to bid and at what price
- Accepts user bids with payment requested only after a win
- Persists auctions, bids, settlements, and leaderboard in SQLite
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
TON_RECEIVER_ADDRESS=your_ton_address_for_winner_payments
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
- `/pay` — open the pending TON invoice for the winning user
- `/leaderboard` — top users and AI bidders

## TON flow

This version no longer pretends to charge the user on every bid.

Current MVP flow:

1. User places bid intent with `/bid`
2. Auction ends
3. If the user wins, the bot sends a `Pay with TON` button
4. The button opens a TON wallet deep link using `ton://transfer/...`
5. The user can then tap `I paid` to confirm in the MVP flow

This is a much better demo flow than charging every bid, and it gives you a meaningful TON touchpoint for the hackathon. The `TonService` keeps an upgrade path for real `@ton/mcp` settlement later.

## Environment variables

See `.env.example`.

Important ones:

- `BOT_TOKEN` — Telegram bot token
- `OPENAI_API_KEY` — OpenAI API key
- `OPENAI_MODEL` — defaults to `gpt-4o-mini`
- `DATABASE_PATH` — SQLite file path
- `AUCTION_DURATION_SEC` — auction length
- `AUCTION_TICK_SEC` — how often AI evaluates bids
- `MIN_BID_STEP` — minimum base bid increment
- `TON_MODE` — `walletlink`, `mock`, or `mcp`
- `TON_RECEIVER_ADDRESS` — wallet that receives winner payments
- `USE_OPENAI_FOR_BANTER` — AI banter on/off
- `USE_OPENAI_FOR_LOTS` — AI lot generation on/off

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
2. Show the generated lot, fair value, reserve, and hype
3. Wait for AI bids to appear live
4. Place a bold human bid like `/bid 25`
5. Show that AI now makes larger, more sensible decisions instead of tiny raises
6. Wait for the auction to end
7. Tap the winner payment button
8. Open `/leaderboard`

## Notes

- One live auction at a time by design for simplicity
- AI bidders are intentionally lightweight but now reason about value and timing
- SQLite keeps setup trivial and local
- No Docker required

## Next upgrades after MVP

- Replace `I paid` mock confirmation with true on-chain verification
- Wire settlement and balances into real `@ton/mcp`
- Add preview images for each lot
- Add a web spectator dashboard
