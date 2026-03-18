import { db } from '../../db/db';
import { env } from '../../config/env';
import { generateAgentBanter, generateLot } from '../ai/ai.service';
import { tonService } from '../ton/ton.service';
import {
  AuctionAgentProfile,
  AuctionRecord,
  AuctionSnapshot,
  AuctionWinner,
  BidRecord,
  LeaderboardEntry,
  PlaceBidInput,
} from './auction.types';

export interface AuctionBroadcast {
  type: 'auction_started' | 'bid_placed' | 'auction_ended' | 'auction_tick';
  text: string;
}

const AGENTS: AuctionAgentProfile[] = [
  { id: 'ai_aggro', name: 'AggroBot', emoji: '🔥', behavior: 'aggro', risk: 0.92, patience: 0.45, tone: 'cocky, aggressive, fast-talking' },
  { id: 'ai_sniper', name: 'SniperBot', emoji: '🎯', behavior: 'sniper', risk: 0.78, patience: 0.95, tone: 'cold, precise, quiet confidence' },
  { id: 'ai_whale', name: 'WhaleMind', emoji: '🐋', behavior: 'value', risk: 0.66, patience: 0.8, tone: 'rich, calm, superior' },
  { id: 'ai_chaos', name: 'ChaosNode', emoji: '⚡', behavior: 'chaotic', risk: 0.83, patience: 0.55, tone: 'unpredictable, playful, dramatic' },
];

const insertAuctionStmt = db.prepare(`
  INSERT INTO auctions (
    lot_title, lot_description, lot_style, lot_origin_story,
    starting_price, current_price, highest_bidder_id, highest_bidder_name,
    status, started_at, ends_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)
`);

const getLiveAuctionStmt = db.prepare(`SELECT * FROM auctions WHERE status = 'live' ORDER BY id DESC LIMIT 1`);
const getAuctionByIdStmt = db.prepare(`SELECT * FROM auctions WHERE id = ?`);
const listBidsByAuctionStmt = db.prepare(`SELECT * FROM bids WHERE auction_id = ? ORDER BY id ASC`);
const insertBidStmt = db.prepare(`
  INSERT INTO bids (auction_id, bidder_id, bidder_name, bidder_type, amount, tx_hash, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updateAuctionBidStmt = db.prepare(`
  UPDATE auctions
  SET current_price = ?, highest_bidder_id = ?, highest_bidder_name = ?
  WHERE id = ?
`);
const closeAuctionStmt = db.prepare(`
  UPDATE auctions
  SET status = 'ended', ended_at = ?, winner_id = ?, winner_name = ?, winning_bid = ?
  WHERE id = ?
`);
const upsertUserStmt = db.prepare(`
  INSERT INTO users (telegram_id, username, wins, total_volume, total_bids, created_at, updated_at)
  VALUES (?, ?, 0, 0, 0, ?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at
`);
const recordBidUserStatsStmt = db.prepare(`
  UPDATE users SET total_bids = total_bids + 1, total_volume = total_volume + ?, updated_at = ? WHERE telegram_id = ?
`);
const recordWinStmt = db.prepare(`
  UPDATE users SET wins = wins + 1, updated_at = ? WHERE telegram_id = ?
`);
const leaderboardStmt = db.prepare(`
  SELECT telegram_id, username, wins, total_volume, total_bids
  FROM users
  ORDER BY wins DESC, total_volume DESC, total_bids DESC, username ASC
  LIMIT ?
`);

export class AuctionService {
  private tickTimer: NodeJS.Timeout | null = null;
  private listeners: Array<(payload: AuctionBroadcast) => Promise<void> | void> = [];

  subscribe(listener: (payload: AuctionBroadcast) => Promise<void> | void): void {
    this.listeners.push(listener);
  }

  async startAuction(): Promise<AuctionSnapshot> {
    const existing = this.getLiveAuction();
    if (existing) {
      return this.getSnapshot(existing.id)!;
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + env.auctionDurationSec * 1000);
    const lot = await generateLot();

    const result = insertAuctionStmt.run(
      lot.title,
      lot.description,
      lot.style,
      lot.originStory,
      env.auctionStartPrice,
      env.auctionStartPrice,
      null,
      null,
      now.toISOString(),
      endsAt.toISOString(),
    );

    const auctionId = Number(result.lastInsertRowid);
    const snapshot = this.getSnapshot(auctionId)!;

    this.startTicking();
    await this.broadcast({
      type: 'auction_started',
      text: this.renderAuctionStart(snapshot),
    });

    return snapshot;
  }

  getLiveAuction(): AuctionRecord | null {
    return (getLiveAuctionStmt.get() as AuctionRecord | undefined) ?? null;
  }

  getSnapshot(auctionId: number): AuctionSnapshot | null {
    const auction = (getAuctionByIdStmt.get(auctionId) as AuctionRecord | undefined) ?? null;
    if (!auction) return null;
    const bids = listBidsByAuctionStmt.all(auctionId) as BidRecord[];
    return { auction, bids };
  }

  async placeUserBid(bidderId: string, bidderName: string, amount: number): Promise<{ snapshot: AuctionSnapshot; txHash: string }> {
    const liveAuction = this.getLiveAuction();
    if (!liveAuction) {
      throw new Error('No live auction. Start one with /newauction.');
    }

    const minAllowed = Number((liveAuction.current_price + env.minBidStep).toFixed(2));
    if (amount < minAllowed) {
      throw new Error(`Minimum allowed bid is ${minAllowed.toFixed(2)} TON.`);
    }

    const balance = await tonService.getBalance(bidderId);
    if (balance < amount) {
      throw new Error(`Insufficient balance. Available: ${balance.toFixed(2)} TON.`);
    }

    const transfer = await tonService.createBidCharge(bidderId, amount);
    if (!transfer.success) {
      throw new Error('TON transfer could not be confirmed.');
    }

    this.persistBid({
      auctionId: liveAuction.id,
      bidderId,
      bidderName,
      bidderType: 'user',
      amount,
      txHash: transfer.txHash,
    });

    const snapshot = this.getSnapshot(liveAuction.id)!;
    await this.broadcast({
      type: 'bid_placed',
      text: this.renderUserBidMessage(snapshot, bidderName, amount, transfer.txHash),
    });

    return { snapshot, txHash: transfer.txHash };
  }

  getLeaderboard(limit = 10): LeaderboardEntry[] {
    return leaderboardStmt.all(limit) as LeaderboardEntry[];
  }

  private persistBid(input: PlaceBidInput): void {
    const now = new Date().toISOString();

    db.transaction(() => {
      insertBidStmt.run(
        input.auctionId,
        input.bidderId,
        input.bidderName,
        input.bidderType,
        input.amount,
        input.txHash ?? null,
        now,
      );

      updateAuctionBidStmt.run(input.amount, input.bidderId, input.bidderName, input.auctionId);

      upsertUserStmt.run(input.bidderId, input.bidderName, now, now);
      if (input.bidderType === 'user') {
        recordBidUserStatsStmt.run(input.amount, now, input.bidderId);
      }
    })();
  }

  private startTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.tickTimer = setInterval(async () => {
      const liveAuction = this.getLiveAuction();
      if (!liveAuction) {
        this.stopTicking();
        return;
      }

      const now = Date.now();
      const msLeft = new Date(liveAuction.ends_at).getTime() - now;
      if (msLeft <= 0) {
        await this.finishAuction(liveAuction.id);
        return;
      }

      const aiAction = await this.tryAiBid(liveAuction);
      const fresh = this.getSnapshot(liveAuction.id)!;
      const secsLeft = Math.max(0, Math.ceil((new Date(fresh.auction.ends_at).getTime() - Date.now()) / 1000));
      await this.broadcast({
        type: 'auction_tick',
        text: aiAction
          ? `${aiAction}\n\n⏳ ${secsLeft}s left.`
          : `⏳ Auction still live: ${secsLeft}s left. Current price: ${fresh.auction.current_price.toFixed(2)} TON.`,
      });
    }, env.auctionTickSec * 1000);
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async tryAiBid(liveAuction: AuctionRecord): Promise<string | null> {
    const msLeft = new Date(liveAuction.ends_at).getTime() - Date.now();
    const secondsLeft = msLeft / 1000;

    const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
    for (const agent of shuffled) {
      if (!this.shouldAgentBid(agent, liveAuction.current_price, secondsLeft)) continue;

      const amount = this.calculateAiBid(agent, liveAuction.current_price, secondsLeft);
      this.persistBid({
        auctionId: liveAuction.id,
        bidderId: agent.id,
        bidderName: agent.name,
        bidderType: 'ai',
        amount,
        txHash: null,
      });

      const banter = await generateAgentBanter(agent, amount, liveAuction.lot_title);
      return `${agent.emoji} <b>${agent.name}</b> bids <b>${amount.toFixed(2)} TON</b>\n<i>${escapeHtml(banter)}</i>`;
    }

    return null;
  }

  private shouldAgentBid(agent: AuctionAgentProfile, currentPrice: number, secondsLeft: number): boolean {
    const urgencyBoost = secondsLeft < 20 ? 0.2 : secondsLeft < 40 ? 0.1 : 0;
    const pricePressure = currentPrice > 1.2 ? -0.15 : currentPrice > 0.7 ? -0.07 : 0;
    let chance = agent.risk * 0.45 + agent.patience * 0.2 + urgencyBoost + pricePressure;

    if (agent.behavior === 'sniper' && secondsLeft > 35) chance -= 0.25;
    if (agent.behavior === 'aggro' && secondsLeft > 35) chance += 0.12;
    if (agent.behavior === 'value' && currentPrice > 0.9) chance -= 0.18;
    if (agent.behavior === 'chaotic') chance += Math.random() * 0.22 - 0.08;

    return Math.random() < Math.max(0.08, Math.min(0.82, chance));
  }

  private calculateAiBid(agent: AuctionAgentProfile, currentPrice: number, secondsLeft: number): number {
    let minJump = env.minBidStep;
    let maxJump = env.minBidStep + 0.06;

    if (agent.behavior === 'aggro') {
      maxJump += 0.06;
    }
    if (agent.behavior === 'sniper' && secondsLeft < 25) {
      minJump += 0.02;
      maxJump += 0.03;
    }
    if (agent.behavior === 'value') {
      maxJump -= 0.02;
    }

    const jump = minJump + Math.random() * Math.max(0.01, maxJump - minJump);
    return Number((currentPrice + jump).toFixed(2));
  }

  async finishAuction(auctionId: number): Promise<AuctionSnapshot> {
    const snapshot = this.getSnapshot(auctionId);
    if (!snapshot) {
      throw new Error('Auction not found.');
    }
    if (snapshot.auction.status === 'ended') {
      this.stopTicking();
      return snapshot;
    }

    const winner = this.resolveWinner(snapshot.bids);
    const endedAt = new Date().toISOString();

    db.transaction(() => {
      closeAuctionStmt.run(
        endedAt,
        winner?.bidderId ?? null,
        winner?.bidderName ?? null,
        winner?.amount ?? null,
        auctionId,
      );

      if (winner && winner.bidderType === 'user') {
        upsertUserStmt.run(winner.bidderId, winner.bidderName, endedAt, endedAt);
        recordWinStmt.run(endedAt, winner.bidderId);
      }
    })();

    this.stopTicking();
    const finalSnapshot = this.getSnapshot(auctionId)!;
    await this.broadcast({
      type: 'auction_ended',
      text: this.renderAuctionEnd(finalSnapshot, winner),
    });

    return finalSnapshot;
  }

  private resolveWinner(bids: BidRecord[]): AuctionWinner | null {
    if (bids.length === 0) return null;
    const winnerBid = bids[bids.length - 1];
    return {
      bidderId: winnerBid.bidder_id,
      bidderName: winnerBid.bidder_name,
      amount: winnerBid.amount,
      bidderType: winnerBid.bidder_type,
    };
  }

  private renderAuctionStart(snapshot: AuctionSnapshot): string {
    const { auction } = snapshot;
    return [
      '🎉 <b>New AI Auction Started</b>',
      '',
      `🖼 <b>${escapeHtml(auction.lot_title)}</b>`,
      `🧬 Style: <b>${escapeHtml(auction.lot_style)}</b>`,
      `📜 ${escapeHtml(auction.lot_description)}`,
      `✨ ${escapeHtml(auction.lot_origin_story)}`,
      '',
      `💰 Starting price: <b>${auction.starting_price.toFixed(2)} TON</b>`,
      `📈 Min step: <b>${env.minBidStep.toFixed(2)} TON</b>`,
      `⏱ Ends in: <b>${env.auctionDurationSec}s</b>`,
      '',
      'Use <code>/bid 0.20</code> to outbid the arena.',
    ].join('\n');
  }

  private renderUserBidMessage(snapshot: AuctionSnapshot, bidderName: string, amount: number, txHash: string): string {
    return [
      '💥 <b>User bid accepted</b>',
      '',
      `👤 ${escapeHtml(bidderName)} pushed the price to <b>${amount.toFixed(2)} TON</b>`,
      `🧾 TX: <code>${txHash}</code>`,
      `🏷 Lot: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`,
      '',
      'AI agents are recalculating…',
    ].join('\n');
  }

  private renderAuctionEnd(snapshot: AuctionSnapshot, winner: AuctionWinner | null): string {
    if (!winner) {
      return [
        '⛔ <b>Auction ended</b>',
        '',
        `Lot: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`,
        'No bids were placed this round.',
      ].join('\n');
    }

    return [
      '🏆 <b>Auction finished</b>',
      '',
      `🖼 Lot: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`,
      `👑 Winner: <b>${escapeHtml(winner.bidderName)}</b> ${winner.bidderType === 'ai' ? '(AI)' : ''}`,
      `💰 Winning bid: <b>${winner.amount.toFixed(2)} TON</b>`,
      '',
      winner.bidderType === 'user'
        ? '🎁 The user beat the machine swarm.'
        : '🤖 AI defended the lot this round.',
    ].join('\n');
  }

  async broadcast(payload: AuctionBroadcast): Promise<void> {
    for (const listener of this.listeners) {
      await listener(payload);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const auctionService = new AuctionService();
