export type AuctionStatus = 'scheduled' | 'live' | 'ended';
export type BidderType = 'user' | 'ai';

export interface GeneratedLot {
  title: string;
  description: string;
  style: string;
  originStory: string;
}

export interface AuctionRecord {
  id: number;
  lot_title: string;
  lot_description: string;
  lot_style: string;
  lot_origin_story: string;
  starting_price: number;
  current_price: number;
  highest_bidder_id: string | null;
  highest_bidder_name: string | null;
  status: AuctionStatus;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  winner_id: string | null;
  winner_name: string | null;
  winning_bid: number | null;
}

export interface BidRecord {
  id: number;
  auction_id: number;
  bidder_id: string;
  bidder_name: string;
  bidder_type: BidderType;
  amount: number;
  tx_hash: string | null;
  created_at: string;
}

export interface AuctionSnapshot {
  auction: AuctionRecord;
  bids: BidRecord[];
}

export interface PlaceBidInput {
  auctionId: number;
  bidderId: string;
  bidderName: string;
  bidderType: BidderType;
  amount: number;
  txHash?: string | null;
}

export interface AuctionWinner {
  bidderId: string;
  bidderName: string;
  amount: number;
  bidderType: BidderType;
}

export interface AuctionAgentProfile {
  id: string;
  name: string;
  emoji: string;
  behavior: 'aggro' | 'sniper' | 'value' | 'chaotic';
  risk: number;
  patience: number;
  tone: string;
}

export interface LeaderboardEntry {
  telegram_id: string;
  username: string;
  wins: number;
  total_volume: number;
  total_bids: number;
}
