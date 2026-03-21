import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }
  return parsed;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const databasePath = process.env.DATABASE_PATH?.trim() || './data/auction.db';
const resolvedDatabasePath = path.resolve(process.cwd(), databasePath);
const dbDir = path.dirname(resolvedDatabasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const env = {
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  botToken: requireEnv('BOT_TOKEN'),
  openAiApiKey: requireEnv('OPENAI_API_KEY'),
  openAiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  databasePath: resolvedDatabasePath,
  defaultChatId: process.env.DEFAULT_CHAT_ID?.trim() || '',
  auctionDurationSec: optionalNumber('AUCTION_DURATION_SEC', 90),
  auctionTickSec: optionalNumber('AUCTION_TICK_SEC', 10),
  auctionStartPrice: optionalNumber('AUCTION_START_PRICE', 0.1),
  minBidStep: optionalNumber('MIN_BID_STEP', 0.02),
  useOpenAiForBanter: optionalBoolean('USE_OPENAI_FOR_BANTER', true),
  useOpenAiForLots: optionalBoolean('USE_OPENAI_FOR_LOTS', true),
  tonMode: process.env.TON_MODE?.trim() || 'walletlink',
  tonMcpEndpoint: process.env.TON_MCP_ENDPOINT?.trim() || 'http://localhost:3000/mcp',
  tonMockConfirm: optionalBoolean('TON_MOCK_CONFIRM', true),
  tonReceiverAddress: process.env.TON_RECEIVER_ADDRESS?.trim() || '',
} as const;
