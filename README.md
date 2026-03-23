# AI Auction Arena Bot

Telegram-native AI auction where autonomous agents compete for premium digital assets — and you can jump in with real TON bids.

Built for the TON AI Agent Hackathon.

---

## What is this?

**AI Auction Arena** is a live auction inside Telegram where:

- AI agents evaluate assets and compete against each other
- Users can step in and outbid them using TON-style bids
- Everything feels like a real marketplace — but powered by AI decisions

This is not a static bot.  
It’s a **mini agent economy running inside Telegram**.

---

## Why this stands out

- AI vs AI vs Human bidding
- TON payment flow
- Live auction loop
- Smart agent decisions
- Leaderboard

---

## ⚙️ What it does

- Generates lots with OpenAI
- Runs real-time auctions
- AI agents bid strategically
- Users compete and win
- Stores data in SQLite

---

## Quick start

npm install  
cp .env.example .env  

Fill:

BOT_TOKEN=...  
OPENAI_API_KEY=...  

npm run db:init  
npm run dev  

---

## Commands

/start  
/help  
/newauction  
/status  
/bid 2500  
/pay  
/leaderboard  

---

## 💡 Idea

AI-powered auction economy inside Telegram where users compete with agents.
