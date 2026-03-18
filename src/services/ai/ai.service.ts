import OpenAI from 'openai';
import { env } from '../../config/env';
import { GeneratedLot, AuctionAgentProfile } from '../auction/auction.types';

const openai = new OpenAI({ apiKey: env.openAiApiKey });

const fallbackStyles = ['Neon Surrealism', 'Glitch Botanical', 'Quantum Noir', 'Retro Futurism'];
const fallbackThemes = [
  'Cyber Garden relic from a lost orbital museum',
  'Encrypted art fragment discovered on a moon-market terminal',
  'Bio-digital postcard from a parallel city',
  'Autonomous sketch traded between rival machine collectors',
];

export async function generateLot(): Promise<GeneratedLot> {
  if (!env.useOpenAiForLots) {
    return buildFallbackLot();
  }

  try {
    const response = await openai.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You generate premium auction lots for a Telegram-native AI bidding arena. Return concise, vivid, commercially attractive copy as JSON only.',
        },
        {
          role: 'user',
          content: `Create one fictional AI-generated digital collectible lot.
Return valid JSON with exactly these keys:
- title
- description
- style
- originStory
Constraints:
- title: max 6 words
- description: max 180 characters
- style: max 3 words
- originStory: max 140 characters
Make it exciting, rare-feeling, and showcase-worthy.`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as GeneratedLot;
    return {
      title: String(parsed.title || '').trim() || buildFallbackLot().title,
      description: String(parsed.description || '').trim() || buildFallbackLot().description,
      style: String(parsed.style || '').trim() || buildFallbackLot().style,
      originStory: String(parsed.originStory || '').trim() || buildFallbackLot().originStory,
    };
  } catch (error) {
    console.error('OpenAI lot generation failed, using fallback lot.', error);
    return buildFallbackLot();
  }
}

export async function generateAgentBanter(agent: AuctionAgentProfile, amount: number, lotTitle: string): Promise<string> {
  if (!env.useOpenAiForBanter) {
    return buildFallbackBanter(agent, amount, lotTitle);
  }

  try {
    const response = await openai.chat.completions.create({
      model: env.openAiModel,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: `You are ${agent.name}, an AI bidder in a Telegram auction arena. Tone: ${agent.tone}. Keep replies short and stylish.`,
        },
        {
          role: 'user',
          content: `Lot: ${lotTitle}
Current bid: ${amount.toFixed(2)} TON
Write one short taunt or reaction, max 12 words, no quotes.`,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || buildFallbackBanter(agent, amount, lotTitle);
  } catch (error) {
    console.error('OpenAI banter generation failed, using fallback banter.', error);
    return buildFallbackBanter(agent, amount, lotTitle);
  }
}

function buildFallbackLot(): GeneratedLot {
  const theme = fallbackThemes[Math.floor(Math.random() * fallbackThemes.length)];
  const style = fallbackStyles[Math.floor(Math.random() * fallbackStyles.length)];
  return {
    title: `${style.split(' ')[0]} Bloom #${Math.floor(Math.random() * 900 + 100)}`,
    description: `${theme}. Limited one-of-one collectible forged for tonight's arena.`,
    style,
    originStory: 'Minted by a restless model cluster after reading market dreams at midnight.',
  };
}

function buildFallbackBanter(agent: AuctionAgentProfile, amount: number, lotTitle: string): string {
  const lines = [
    `${agent.emoji} ${lotTitle} belongs in my vault.`,
    `${agent.emoji} ${amount.toFixed(2)} TON is still a bargain.`,
    `${agent.emoji} Humans blink. I compound.`,
    `${agent.emoji} This is where weak bidders fold.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
