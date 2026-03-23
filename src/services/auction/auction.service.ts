import { InlineKeyboard } from 'grammy';
import { db } from '../../db/db';
import { env } from '../../config/env';
import { decideAgentBid, generateAgentBanter, generateLot } from '../ai/ai.service';
import { tonService } from '../ton/ton.service';
import {
  AuctionAgentProfile,
  AuctionRecord,
  AuctionSnapshot,
  AuctionWinner,
  BidRecord,
  LeaderboardEntry,
  PaymentSettlementRecord,
  PlaceBidInput,
} from './auction.types';

export interface AuctionBroadcast {
  type: 'auction_started' | 'bid_placed' | 'auction_ended' | 'auction_tick';
  text: string;
  replyMarkup?: InlineKeyboard;
}

const AGENTS: AuctionAgentProfile[] = [
  { id: 'ai_aggro', name: 'AggroBot', emoji: '🔥', behavior: 'aggro', risk: 0.94, patience: 0.4, tone: 'cocky, aggressive, fast-talking' },
  { id: 'ai_sniper', name: 'SniperBot', emoji: '🎯', behavior: 'sniper', risk: 0.8, patience: 0.96, tone: 'cold, precise, quiet confidence' },
  { id: 'ai_whale', name: 'WhaleMind', emoji: '🐋', behavior: 'value', risk: 0.68, patience: 0.82, tone: 'rich, calm, superior' },
  { id: 'ai_chaos', name: 'ChaosNode', emoji: '⚡', behavior: 'chaotic', risk: 0.86, patience: 0.58, tone: 'unpredictable, playful, dramatic' },
];

const AI_BID_CUTOFF_SECONDS = 5;

const insertAuctionStmt = db.prepare(`
  INSERT INTO auctions (
    lot_title, lot_description, lot_style, lot_origin_story,
    estimated_value_ton, reserve_price_ton, hype_score,
    starting_price, current_price, highest_bidder_id, highest_bidder_name,
    status, started_at, ends_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)
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
  INSERT INTO users (telegram_id, username, entity_type, wins, total_volume, total_bids, created_at, updated_at)
  VALUES (?, ?, ?, 0, 0, 0, ?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, entity_type = excluded.entity_type, updated_at = excluded.updated_at
`);
const recordBidStatsStmt = db.prepare(`
  UPDATE users SET total_bids = total_bids + 1, total_volume = total_volume + ?, updated_at = ? WHERE telegram_id = ?
`);
const recordWinStmt = db.prepare(`
  UPDATE users SET wins = wins + 1, updated_at = ? WHERE telegram_id = ?
`);
const leaderboardStmt = db.prepare(`
  SELECT telegram_id, username, entity_type, wins, total_volume, total_bids
  FROM users
  ORDER BY wins DESC, total_volume DESC, total_bids DESC, username ASC
  LIMIT ?
`);
const insertSettlementStmt = db.prepare(`
  INSERT INTO payment_settlements (
    auction_id, winner_id, winner_name, amount, status, payment_address, payment_memo, payment_url, tx_hash, created_at, paid_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getPendingSettlementByWinnerStmt = db.prepare(`
  SELECT * FROM payment_settlements WHERE winner_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1
`);

export class AuctionService {
  private tickTimer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
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
    const openingPrice = this.computeOpeningPrice(lot.estimatedValueTon, lot.reservePriceTon, lot.hypeScore);

    const result = insertAuctionStmt.run(
      lot.title,
      lot.description,
      lot.style,
      lot.originStory,
      lot.estimatedValueTon,
      lot.reservePriceTon,
      lot.hypeScore,
      openingPrice,
      openingPrice,
      null,
      null,
      now.toISOString(),
      endsAt.toISOString(),
    );

    const auctionId = Number(result.lastInsertRowid);
    const snapshot = this.getSnapshot(auctionId)!;
    this.startTicking();
    await this.broadcast({ type: 'auction_started', text: this.renderAuctionStart(snapshot) });
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

  getPendingSettlementForWinner(winnerId: string): PaymentSettlementRecord | null {
    return (getPendingSettlementByWinnerStmt.get(winnerId) as PaymentSettlementRecord | undefined) ?? null;
  }

  async placeUserBid(bidderId: string, bidderName: string, amount: number): Promise<{ snapshot: AuctionSnapshot; previousPrice: number; minAllowed: number }> {
    const balance = await tonService.getBalance(bidderId);
    if (balance < amount) {
      throw new Error(`Insufficient balance. Available: ${balance.toFixed(2)} TON.`);
    }

    const result = this.placeBid({
      bidderId,
      bidderName,
      bidderType: 'user',
      amount,
      txHash: null,
    });

    await this.broadcast({
      type: 'bid_placed',
      text: this.renderUserBidMessage(result.snapshot, bidderName, amount, result.previousPrice, result.minAllowed),
    });

    return result;
  }

  getLeaderboard(limit = 10): LeaderboardEntry[] {
    return leaderboardStmt.all(limit) as LeaderboardEntry[];
  }

  getNextMinimumBid(currentPrice: number): number {
    return this.getMinAllowedBid(currentPrice);
  }

  private placeBid(input: Omit<PlaceBidInput, 'auctionId'>): { snapshot: AuctionSnapshot; previousPrice: number; minAllowed: number } {
    const liveAuction = this.getLiveAuction();
    if (!liveAuction) {
      throw new Error('No live auction. Start one with /newauction.');
    }
  
    if (liveAuction.status !== 'live') {
      throw new Error('Auction is not active.');
    }
  
    const msLeft = new Date(liveAuction.ends_at).getTime() - Date.now();
    const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  
    if (msLeft <= 0) {
      throw new Error('Auction is already ending. Please wait for settlement.');
    }
  
    if (input.bidderType === 'ai' && secondsLeft <= AI_BID_CUTOFF_SECONDS) {
      throw new Error('AI bidding window is closed.');
    }
  
    const previousPrice = liveAuction.current_price;
    const minAllowed = this.getMinAllowedBid(previousPrice);
  
    if (input.amount < minAllowed) {
      throw new Error(
        `Bid rejected. Current highest bid: ${previousPrice.toFixed(2)} TON. Minimum allowed next bid: ${minAllowed.toFixed(2)} TON.`,
      );
    }
  
    if (
      liveAuction.highest_bidder_id === input.bidderId &&
      liveAuction.highest_bidder_name === input.bidderName
    ) {
      throw new Error(
        input.bidderType === 'ai'
          ? 'Agent is already the highest bidder.'
          : 'You are already the highest bidder. Wait for a challenge.',
      );
    }
  
    const now = new Date().toISOString();
    db.transaction(() => {
      insertBidStmt.run(
        liveAuction.id,
        input.bidderId,
        input.bidderName,
        input.bidderType,
        Number(input.amount.toFixed(2)),
        input.txHash ?? null,
        now,
      );
  
      updateAuctionBidStmt.run(
        Number(input.amount.toFixed(2)),
        input.bidderId,
        input.bidderName,
        liveAuction.id,
      );
  
      upsertUserStmt.run(input.bidderId, input.bidderName, input.bidderType, now, now);
      recordBidStatsStmt.run(Number(input.amount.toFixed(2)), now, input.bidderId);
    })();
  
    return {
      snapshot: this.getSnapshot(liveAuction.id)!,
      previousPrice,
      minAllowed,
    };
  }

  private startTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
  
    this.tickTimer = setInterval(async () => {
      if (this.tickInFlight) return;
      this.tickInFlight = true;
  
      try {
        const liveAuction = this.getLiveAuction();
        if (!liveAuction) {
          this.stopTicking();
          return;
        }
  
        const msLeft = new Date(liveAuction.ends_at).getTime() - Date.now();
        const secsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  
        if (msLeft <= 0) {
          await this.finishAuction(liveAuction.id);
          return;
        }
  
        let aiAction: string | null = null;
  
        if (secsLeft > AI_BID_CUTOFF_SECONDS) {
          aiAction = await this.tryAiBid(liveAuction.id);
        }
  
        const fresh = this.getSnapshot(liveAuction.id);
        if (!fresh) return;
  
        const freshSecsLeft = Math.max(
          0,
          Math.ceil((new Date(fresh.auction.ends_at).getTime() - Date.now()) / 1000),
        );
  
        if (freshSecsLeft <= 0) {
          await this.finishAuction(liveAuction.id);
          return;
        }
  
        await this.broadcast({
          type: 'auction_tick',
          text: aiAction
            ? `${aiAction}
  
  ⏳ ${freshSecsLeft}s left.`
            : `⏳ Auction still live: ${freshSecsLeft}s left. Current price: ${fresh.auction.current_price.toFixed(2)} TON.`,
        });
      } finally {
        this.tickInFlight = false;
      }
    }, env.auctionTickSec * 1000);
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private buildAgentPrivateMax(auction: AuctionRecord, agent: AuctionAgentProfile): number {
    const fair = auction.estimated_value_ton;
    const mood = 1 + ((auction.hype_score - 70) / 1000);
    let multiplier = 1;
    switch (agent.behavior) {
      case 'aggro':
        multiplier = 1.16;
        break;
      case 'sniper':
        multiplier = 1.05;
        break;
      case 'value':
        multiplier = 0.92;
        break;
      case 'chaotic':
        multiplier = 1.0;
        break;
    }
    return Number((fair * multiplier * mood).toFixed(2));
  }

  private async tryAiBid(auctionId: number): Promise<string | null> {
    const initialSnapshot = this.getSnapshot(auctionId);
    if (!initialSnapshot) return null;
  
    const initialAuction = initialSnapshot.auction;
    const initialSecondsLeft = Math.max(
      0,
      Math.ceil((new Date(initialAuction.ends_at).getTime() - Date.now()) / 1000),
    );
  
    if (initialSecondsLeft <= AI_BID_CUTOFF_SECONDS) {
      return null;
    }
  
    const shuffled = [...AGENTS].sort(() => Math.random() - 0.5);
  
    for (const agent of shuffled) {
      const currentSnapshot = this.getSnapshot(auctionId);
      if (!currentSnapshot) return null;
  
      const live = currentSnapshot.auction;
      if (live.status !== 'live') return null;
  
      const secondsLeft = Math.max(
        0,
        Math.ceil((new Date(live.ends_at).getTime() - Date.now()) / 1000),
      );
  
      if (secondsLeft <= AI_BID_CUTOFF_SECONDS) {
        return null;
      }
  
      const isLeader =
        live.highest_bidder_id === agent.id &&
        live.highest_bidder_name === agent.name;
  
      if (isLeader) {
        continue;
      }
  
      const minAllowedBid = this.getMinAllowedBid(live.current_price);
      const privateMaxBid = this.buildAgentPrivateMax(live, agent);
  
      if (minAllowedBid > privateMaxBid) {
        continue;
      }
  
      const decision = await decideAgentBid({
        agent,
        lot: {
          title: live.lot_title,
          description: live.lot_description,
          estimatedValueTon: live.estimated_value_ton,
          reservePriceTon: live.reserve_price_ton,
          hypeScore: live.hype_score,
        },
        currentPrice: live.current_price,
        minAllowedBid,
        secondsLeft,
        highestBidderName: live.highest_bidder_name,
        recentBids: currentSnapshot.bids,
        privateMaxBid,
        isLeader,
      });
  
      if (!decision.shouldBid || !decision.bidAmount) {
        continue;
      }
  
      const refreshedSnapshot = this.getSnapshot(auctionId);
      if (!refreshedSnapshot) return null;
  
      const refreshedAuction = refreshedSnapshot.auction;
      if (refreshedAuction.status !== 'live') return null;
  
      const refreshedSecondsLeft = Math.max(
        0,
        Math.ceil((new Date(refreshedAuction.ends_at).getTime() - Date.now()) / 1000),
      );
  
      if (refreshedSecondsLeft <= AI_BID_CUTOFF_SECONDS) {
        return null;
      }
  
      const refreshedMinAllowed = this.getMinAllowedBid(refreshedAuction.current_price);
      const refreshedPrivateMaxBid = this.buildAgentPrivateMax(refreshedAuction, agent);
  
      if (decision.bidAmount < refreshedMinAllowed) {
        continue;
      }
  
      const boundedAmount = this.normalizeAgentBidAmount(
        agent,
        refreshedAuction.current_price,
        refreshedMinAllowed,
        decision.bidAmount,
        refreshedPrivateMaxBid,
        refreshedSecondsLeft,
        refreshedAuction.estimated_value_ton,
      );
  
      if (boundedAmount === null) {
        continue;
      }
  
      let placed;
      try {
        placed = this.placeBid({
          bidderId: agent.id,
          bidderName: agent.name,
          bidderType: 'ai',
          amount: boundedAmount,
          txHash: null,
        });
      } catch {
        continue;
      }
  
      const verifySnapshot = this.getSnapshot(auctionId);
      if (!verifySnapshot) return null;
  
      const verifyAuction = verifySnapshot.auction;
  
      if (
        verifyAuction.highest_bidder_id !== agent.id ||
        verifyAuction.highest_bidder_name !== agent.name ||
        Number(verifyAuction.current_price.toFixed(2)) !== Number(boundedAmount.toFixed(2))
      ) {
        continue;
      }
  
      const banter = await generateAgentBanter(agent, boundedAmount, verifyAuction.lot_title);
  
      return `${agent.emoji} <b>${agent.name}</b> bids <b>${boundedAmount.toFixed(2)} TON</b>
  <i>${escapeHtml(decision.reason)} • ${escapeHtml(banter)}</i>`;
    }
  
    return null;
  }

  private normalizeAgentBidAmount(
    agent: AuctionAgentProfile,
    currentPrice: number,
    minAllowed: number,
    requestedAmount: number,
    privateMaxBid: number,
    secondsLeft: number,
    fairValue: number,
  ): number | null {
    if (minAllowed > privateMaxBid) return null;
    if (secondsLeft <= AI_BID_CUTOFF_SECONDS) return null;
  
    let amount = Math.max(minAllowed, Number(requestedAmount.toFixed(2)));
    const early = secondsLeft > env.auctionDurationSec * 0.55;
    const late = secondsLeft <= 15;
    const veryLate = secondsLeft <= 8;
  
    if (agent.behavior === 'chaotic') {
      amount =
        currentPrice >= fairValue * 0.55
          ? minAllowed + 1
          : Math.max(amount, currentPrice + Math.max(currentPrice * 0.05, fairValue * 0.05));
    } else if (agent.behavior === 'aggro' && early) {
      amount = Math.max(
        amount,
        currentPrice + Math.max(currentPrice * 0.06, fairValue * 0.035),
      );
    } else if (agent.behavior === 'value') {
      amount = Math.max(
        minAllowed,
        Math.min(amount, currentPrice + Math.max(currentPrice * 0.03, fairValue * 0.025)),
      );
    } else if (agent.behavior === 'sniper') {
      if (!late) return null;
  
      if (veryLate) {
        amount = Math.max(minAllowed, minAllowed + 1);
      } else {
        amount = Math.max(minAllowed, Math.min(amount, minAllowed + Math.max(currentPrice * 0.003, 0.5)));
      }
    }
  
    amount = Number(amount.toFixed(2));
  
    const maxJumpPct =
      agent.behavior === 'aggro'
        ? 0.14
        : agent.behavior === 'chaotic'
          ? 0.18
          : agent.behavior === 'sniper'
            ? 0.08
            : 0.1;
  
    const maxAllowedByJump = Number((currentPrice * (1 + maxJumpPct)).toFixed(2));
    amount = Math.min(amount, maxAllowedByJump, Number(privateMaxBid.toFixed(2)));
    amount = Number(Math.max(minAllowed, amount).toFixed(2));
  
    if (amount < minAllowed || amount > privateMaxBid) return null;
    return amount;
  }

  private getMinAllowedBid(currentPrice: number): number {
    let pct = 0.03;
    if (currentPrice < 10) pct = 0.15;
    else if (currentPrice < 100) pct = 0.1;
    else if (currentPrice < 1000) pct = 0.06;
    const absoluteStep = Math.max(env.minBidStep, Number((currentPrice * pct).toFixed(2)));
    return Number((currentPrice + absoluteStep).toFixed(2));
  }

  private computeOpeningPrice(fairValue: number, reservePrice: number, hypeScore: number): number {
    const baseMultiplier = hypeScore >= 85 ? 0.62 : hypeScore >= 75 ? 0.56 : 0.5;
    const opening = Math.max(fairValue * baseMultiplier, reservePrice * 0.7);
    return Number(opening.toFixed(2));
  }

  async finishAuction(auctionId: number): Promise<AuctionSnapshot> {
    const snapshot = this.getSnapshot(auctionId);
    if (!snapshot) throw new Error('Auction not found.');
    if (snapshot.auction.status === 'ended') {
      this.stopTicking();
      return snapshot;
    }

    const winner = this.resolveWinner(snapshot.bids);
    const endedAt = new Date().toISOString();
    let replyMarkup: InlineKeyboard | undefined;

    db.transaction(() => {
      closeAuctionStmt.run(
        endedAt,
        winner?.bidderId ?? null,
        winner?.bidderName ?? null,
        winner?.amount ?? null,
        auctionId,
      );

      if (winner) {
        upsertUserStmt.run(winner.bidderId, winner.bidderName, winner.bidderType, endedAt, endedAt);
        recordWinStmt.run(endedAt, winner.bidderId);
      }

      if (winner && winner.bidderType === 'user') {
        const payment = tonService.buildPaymentRequest({
          userId: winner.bidderId,
          amountTon: winner.amount,
          auctionId,
        });

        insertSettlementStmt.run(
          auctionId,
          winner.bidderId,
          winner.bidderName,
          winner.amount,
          'pending',
          payment.address,
          payment.memo,
          payment.url,
          null,
          endedAt,
          null,
        );
      }
    })();

    if (winner?.bidderType === 'user') {
      replyMarkup = new InlineKeyboard().url('💎 Pay with TON', this.getPendingSettlementForWinner(winner.bidderId)?.payment_url ?? 'https://ton.org');
    }

    this.stopTicking();
    const finalSnapshot = this.getSnapshot(auctionId)!;
    await this.broadcast({ type: 'auction_ended', text: this.renderAuctionEnd(finalSnapshot, winner), replyMarkup });
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
    const nextMin = this.getMinAllowedBid(auction.current_price);
    return [
      '🎉 <b>New AI Auction Started</b>',
      '',
      `🖼 <b>${escapeHtml(auction.lot_title)}</b>`,
      `🧬 Style: <b>${escapeHtml(auction.lot_style)}</b>`,
      `📜 ${escapeHtml(auction.lot_description)}`,
      `✨ ${escapeHtml(auction.lot_origin_story)}`,
      '',
      `🧠 AI fair value: <b>${auction.estimated_value_ton.toFixed(2)} TON</b>`,
      `🔐 Reserve threshold: <b>${auction.reserve_price_ton.toFixed(2)} TON</b>`,
      `🔥 Hype score: <b>${auction.hype_score}/100</b>`,
      `💰 Starting price: <b>${auction.starting_price.toFixed(2)} TON</b>`,
      `📈 Next minimum bid: <b>${nextMin.toFixed(2)} TON</b>`,
      `⏱ Ends in: <b>${env.auctionDurationSec}s</b>`,
      '',
      `Use <code>/bid ${nextMin.toFixed(2)}</code> to outbid the arena.`,
    ].join('\n');
  }

  private renderUserBidMessage(snapshot: AuctionSnapshot, bidderName: string, amount: number, previousPrice: number, minAllowed: number): string {
    const nextMin = this.getMinAllowedBid(amount);
    return [
      '💥 <b>User bid accepted</b>',
      '',
      `👤 ${escapeHtml(bidderName)} pushed the price to <b>${amount.toFixed(2)} TON</b>`,
      `🏷 Lot: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`,
      `🧾 Previous highest bid: <b>${previousPrice.toFixed(2)} TON</b>`,
      `📉 Minimum required bid was: <b>${minAllowed.toFixed(2)} TON</b>`,
      `📈 Next minimum bid: <b>${nextMin.toFixed(2)} TON</b>`,
      '',
      'No TON is charged yet. Payment is requested only if you win.',
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
        ? '💎 Complete payment using the TON button below.'
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
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const auctionService = new AuctionService();
