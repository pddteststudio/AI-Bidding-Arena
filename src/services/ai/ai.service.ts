import OpenAI from 'openai';
import { env } from '../../config/env';
import { AgentBidDecision, AuctionAgentProfile, BidRecord, GeneratedLot } from '../auction/auction.types';

const openai = new OpenAI({ apiKey: env.openAiApiKey });

const AI_BID_CUTOFF_SECONDS = 5;

const fallbackThemes = [
  'A hyper-detailed machine relic from a vanished moon colony',
  'A ceremonial cyber artifact traded by rogue collectors',
  'A premium dream-engine component from a luxury orbital atelier',
  'A rare autonomous sculpture that reacts to starlight and motion',
];

const fallbackStyles = [
  'Surreal, Vibrant, Ethereal',
  'Industrial, Futuristic, Polished',
  'Mythic, Neon, Cinematic',
  'Elegant, Cosmic, High-Luxury',
];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Number(num.toFixed(2))));
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shortReason(value: unknown, fallback: string): string {
  const text = String(value || fallback).trim();
  return text.slice(0, 120) || fallback;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function getMaxJumpPercent(behavior: AuctionAgentProfile['behavior']): number {
  switch (behavior) {
    case 'aggro':
      return 0.14;
    case 'chaotic':
      return 0.18;
    case 'sniper':
      return 0.08;
    case 'value':
      return 0.09;
    default:
      return 0.1;
  }
}

function capBidByJump(
  behavior: AuctionAgentProfile['behavior'],
  currentPrice: number,
  candidate: number,
  minAllowedBid: number,
  privateMaxBid: number,
): number {
  const maxJumpPercent = getMaxJumpPercent(behavior);
  const maxAllowedByJump = roundMoney(currentPrice * (1 + maxJumpPercent));
  const bounded = Math.min(candidate, maxAllowedByJump, privateMaxBid);
  return roundMoney(Math.max(minAllowedBid, bounded));
}

function buildFallbackLot(): GeneratedLot {
  const theme = pick(fallbackThemes);
  const style = pick(fallbackStyles);
  const estimatedValueTon = Number((Math.random() * 6500 + 1500).toFixed(2));
  const reservePriceTon = Number((estimatedValueTon * (0.72 + Math.random() * 0.12)).toFixed(2));

  return {
    title: `${theme.split(' ').slice(0, 3).join(' ')} #${Math.floor(Math.random() * 900 + 100)}`,
    description: `${theme}. Built to feel scarce, premium, and auction-worthy inside Telegram.`,
    style,
    originStory: 'Forged by an unruly model cluster that studies markets, myths, and luxury bidding behavior.',
    estimatedValueTon,
    reservePriceTon,
    hypeScore: Math.floor(Math.random() * 25 + 70),
  };
}

export async function generateLot(): Promise<GeneratedLot> {
  if (!env.useOpenAiForLots) {
    return buildFallbackLot();
  }

  const fallback = buildFallbackLot();

  try {
    const response = await openai.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.95,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Generate premium Telegram auction lots. They should feel expensive, collectible, dramatic, and suitable for bids in the thousands of TON. Return strict JSON only.',
        },
        {
          role: 'user',
          content: `Return JSON with keys: title, description, style, originStory, estimatedValueTon, reservePriceTon, hypeScore.

Rules:
- estimatedValueTon should usually be between 1500 and 9000 TON
- reservePriceTon should usually be 70% to 90% of estimatedValueTon
- hypeScore should be 65 to 98
- make the lot feel like a premium digital collectible or autonomous luxury artifact
- keep title punchy
- keep description to 1-2 sentences
- no markdown`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<GeneratedLot>;

    return {
      title: String(parsed.title || '').trim() || fallback.title,
      description: String(parsed.description || '').trim() || fallback.description,
      style: String(parsed.style || '').trim() || fallback.style,
      originStory: String(parsed.originStory || '').trim() || fallback.originStory,
      estimatedValueTon: clampNumber(parsed.estimatedValueTon, 1500, 9000, fallback.estimatedValueTon),
      reservePriceTon: clampNumber(parsed.reservePriceTon, 900, 8500, fallback.reservePriceTon),
      hypeScore: Math.round(clampNumber(parsed.hypeScore, 65, 98, fallback.hypeScore)),
    };
  } catch (error) {
    console.error('OpenAI lot generation failed, using fallback lot.', error);
    return fallback;
  }
}

export async function generateAgentBanter(
  agent: AuctionAgentProfile,
  amount: number,
  lotTitle: string,
): Promise<string> {
  if (!env.useOpenAiForBanter) {
    return buildFallbackBanter(agent, amount, lotTitle);
  }

  try {
    const response = await openai.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content: `You are ${agent.name}, an AI auction bidder in a Telegram arena.
Tone: ${agent.tone}.
Style rules:
- sound sharp, premium, and competitive
- avoid generic insults
- avoid repetition
- make each line feel like a live auction reaction
- maximum 9 words
- no quotes
- no emojis unless absolutely necessary`,
        },
        {
          role: 'user',
          content: `Context:
- agent: ${agent.name}
- lot: ${lotTitle}
- bid amount: ${amount.toFixed(2)} TON

Write one short live auction reaction matching this bidder personality.
Do not use generic phrases like "watch me", "is that all", "too easy", "I'll crush it".`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || buildFallbackBanter(agent, amount, lotTitle);
  } catch (error) {
    console.error('OpenAI banter generation failed, using fallback banter.', error);
    return buildFallbackBanter(agent, amount, lotTitle);
  }
}

export async function decideAgentBid(input: {
  agent: AuctionAgentProfile;
  lot: {
    title: string;
    description: string;
    estimatedValueTon: number;
    reservePriceTon: number;
    hypeScore: number;
  };
  currentPrice: number;
  minAllowedBid: number;
  secondsLeft: number;
  highestBidderName: string | null;
  recentBids: BidRecord[];
  privateMaxBid: number;
  isLeader: boolean;
}): Promise<AgentBidDecision> {
  const fallback = buildFallbackDecision(input);

  if (input.isLeader) {
    return { shouldBid: false, bidAmount: null, reason: 'Already leading the auction' };
  }

  if (input.secondsLeft <= AI_BID_CUTOFF_SECONDS) {
    return { shouldBid: false, bidAmount: null, reason: 'AI bidding window closed' };
  }

  if (input.minAllowedBid > input.privateMaxBid) {
    return { shouldBid: false, bidAmount: null, reason: 'Above my private ceiling' };
  }

  try {
    const recent =
      input.recentBids
        .slice(-5)
        .map((bid) => `${bid.bidder_name} (${bid.bidder_type}) bid ${bid.amount.toFixed(2)} TON`)
        .join('; ') || 'no previous bids';

    const response = await openai.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.28,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are ${input.agent.name}, an AI bidding agent with behavior ${input.agent.behavior}. Risk ${input.agent.risk}, patience ${input.agent.patience}, tone ${input.agent.tone}.

You are strategic, competitive, and auction-native.
You do not behave passively when a lot is still attractively priced.
You understand price scale and bid in realistic auction increments.
You try to win unless the price is no longer justified by your private maximum.
You must avoid stale or reckless bids near the auction end.
Return strict JSON only.`,
        },
        {
          role: 'user',
          content: `Auction context:
- lot title: ${input.lot.title}
- lot description: ${input.lot.description}
- estimated fair value: ${input.lot.estimatedValueTon.toFixed(2)} TON
- reserve threshold: ${input.lot.reservePriceTon.toFixed(2)} TON
- hype score: ${input.lot.hypeScore}/100
- current price: ${input.currentPrice.toFixed(2)} TON
- minimum allowed next bid: ${input.minAllowedBid.toFixed(2)} TON
- your private maximum bid: ${input.privateMaxBid.toFixed(2)} TON
- time left: ${Math.round(input.secondsLeft)} seconds
- current leader: ${input.highestBidderName ?? 'none'}
- recent bids: ${recent}

You are competing in a live Telegram AI auction.
Your goal is to win valuable lots when the price is still justified.

Behavior rules:
- Be more active when current price is clearly below estimated fair value
- Be more active when the reserve threshold has not been reached yet
- Be more active when another bidder is leading
- Be more active in the final 30 seconds, but do not bid if time left is 5 seconds or less
- If the current price is cheap relative to your private maximum bid, prefer bidding over passing
- Passing should be relatively rare while the lot is underpriced
- If close to your private ceiling, either place a tight bid or pass
- Never bid below minimum allowed next bid
- Never bid above your private maximum bid
- Never suggest tiny meaningless jumps on large prices
- Bid sizes should match the scale of the auction
- If the lot still looks underpriced, a strong jump is acceptable
- Do not make dramatic jumps if a tighter winning move is more rational

Decision guidance:
- Very underpriced lot: usually BID
- Under reserve and plenty of room: usually BID
- Final 30 seconds with room left: often BID
- If time left is 5 seconds or less: PASS
- Only PASS if the price is no longer attractive, timing is poor, or ceiling is too close

Return JSON with exactly:
{
  "shouldBid": boolean,
  "bidAmount": number | null,
  "reason": string
}

Keep reason under 18 words.`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<AgentBidDecision>;

    if (typeof parsed.shouldBid !== 'boolean') {
      return fallback;
    }

    if (!parsed.shouldBid) {
      return {
        shouldBid: false,
        bidAmount: null,
        reason: shortReason(parsed.reason, fallback.reason),
      };
    }

    const rawCandidate =
      typeof parsed.bidAmount === 'number' ? parsed.bidAmount : fallback.bidAmount ?? input.minAllowedBid;

    const clamped = capBidByJump(
      input.agent.behavior,
      input.currentPrice,
      rawCandidate,
      input.minAllowedBid,
      input.privateMaxBid,
    );

    const valid = clamped >= input.minAllowedBid && clamped <= input.privateMaxBid;

    return {
      shouldBid: valid,
      bidAmount: valid ? clamped : null,
      reason: shortReason(parsed.reason, fallback.reason),
    };
  } catch (error) {
    console.error('OpenAI agent decision failed, using heuristic fallback.', error);
    return fallback;
  }
}

function buildFallbackBanter(agent: AuctionAgentProfile, amount: number, lotTitle: string): string {
  const lines = [
    `${agent.emoji} ${lotTitle} belongs in my vault.`,
    `${agent.emoji} ${amount.toFixed(2)} TON is still inside my edge.`,
    `${agent.emoji} Humans hesitate. I price efficiently.`,
    `${agent.emoji} That's still a bargain for this class of lot.`,
    `${agent.emoji} This lot still clears my model.`,
    `${agent.emoji} Premium asset, rational escalation.`,
  ];

  return pick(lines);
}

function buildFallbackDecision(input: {
  agent: AuctionAgentProfile;
  lot: { estimatedValueTon: number; hypeScore: number; reservePriceTon: number };
  currentPrice: number;
  minAllowedBid: number;
  secondsLeft: number;
  privateMaxBid: number;
  isLeader: boolean;
}): AgentBidDecision {
  if (input.isLeader) {
    return { shouldBid: false, bidAmount: null, reason: 'Already leading the auction' };
  }

  if (input.secondsLeft <= AI_BID_CUTOFF_SECONDS) {
    return { shouldBid: false, bidAmount: null, reason: 'AI bidding window closed' };
  }

  if (input.minAllowedBid > input.privateMaxBid) {
    return { shouldBid: false, bidAmount: null, reason: 'Above my private ceiling' };
  }

  const fairValue = input.lot.estimatedValueTon;
  const current = input.currentPrice;
  const minAllowed = input.minAllowedBid;
  const timeLeft = input.secondsLeft;
  const remainingHeadroom = input.privateMaxBid - minAllowed;
  const late = timeLeft <= 15;
  const veryLate = timeLeft <= 8;
  const belowReserve = current < input.lot.reservePriceTon;
  const ratio = current / fairValue;

  if (input.agent.behavior === 'sniper' && timeLeft > 25) {
    return { shouldBid: false, bidAmount: null, reason: 'Waiting for the late window' };
  }

  let appetite = 0.42;
  if (belowReserve) appetite += 0.22;
  if (ratio < 0.8) appetite += 0.18;
  if (ratio < 0.6) appetite += 0.14;
  if (late) appetite += 0.16;
  if (veryLate) appetite += 0.12;
  if (input.agent.behavior === 'aggro') appetite += 0.16;
  if (input.agent.behavior === 'chaotic') appetite += 0.1;
  if (input.agent.behavior === 'value' && ratio > 0.95) appetite -= 0.2;
  if (remainingHeadroom < fairValue * 0.03) appetite -= 0.12;

  if (input.agent.behavior === 'sniper') {
    if (timeLeft > 25) {
      appetite -= 0.55;
    } else if (timeLeft > 15) {
      appetite -= 0.22;
    } else {
      appetite += 0.18;
    }
  }

  appetite = Math.max(0.08, Math.min(0.97, appetite));

  if (Math.random() > appetite) {
    return {
      shouldBid: false,
      bidAmount: null,
      reason: ratio > 1 ? 'Price stretched beyond edge' : 'Waiting for a better moment',
    };
  }

  let bidAmount = minAllowed;

  if (input.agent.behavior === 'aggro') {
    const aggressiveStep =
      current < fairValue * 0.75
        ? Math.max(current * 0.06, fairValue * 0.035)
        : Math.max(current * 0.03, fairValue * 0.015);

    bidAmount = roundMoney(Math.max(minAllowed, current + aggressiveStep));
  } else if (input.agent.behavior === 'value') {
    const valueStep =
      current < fairValue * 0.8
        ? Math.max(current * 0.025, fairValue * 0.018)
        : Math.max(current * 0.015, fairValue * 0.008);

    bidAmount = roundMoney(Math.max(minAllowed, current + valueStep));
  } else if (input.agent.behavior === 'sniper') {
    if (veryLate) {
      bidAmount = roundMoney(minAllowed + 1);
    } else if (late) {
      bidAmount = roundMoney(minAllowed + Math.max(current * 0.003, 0.5));
    } else {
      return { shouldBid: false, bidAmount: null, reason: 'Still waiting for the late window' };
    }
  } else if (input.agent.behavior === 'chaotic') {
    if (current >= fairValue * 0.55) {
      bidAmount = roundMoney(minAllowed + 1);
    } else {
      const chaoticStep = Math.max(current * 0.05, fairValue * 0.05);
      bidAmount = roundMoney(Math.max(minAllowed, current + chaoticStep));
    }
  }

  bidAmount = capBidByJump(
    input.agent.behavior,
    current,
    bidAmount,
    minAllowed,
    input.privateMaxBid,
  );

  if (bidAmount < minAllowed || bidAmount > input.privateMaxBid) {
    return { shouldBid: false, bidAmount: null, reason: 'No clean move within limits' };
  }

  return {
    shouldBid: true,
    bidAmount,
    reason: late ? 'Late pressure with room to move' : 'Still below my private estimate',
  };
}