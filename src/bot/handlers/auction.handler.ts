import { Bot, Context } from 'grammy';
import { auctionService } from '../../services/auction/auction.service';

function formatStatus(): string {
  const live = auctionService.getLiveAuction();
  if (!live) {
    return 'No live auction right now. Start one with /newauction.';
  }

  const secondsLeft = Math.max(0, Math.ceil((new Date(live.ends_at).getTime() - Date.now()) / 1000));
  return [
    '📡 <b>Live auction status</b>',
    '',
    `🖼 <b>${escapeHtml(live.lot_title)}</b>`,
    `💰 Current price: <b>${live.current_price.toFixed(2)} TON</b>`,
    `🏁 Highest bidder: <b>${escapeHtml(live.highest_bidder_name ?? 'No bids yet')}</b>`,
    `⏱ Time left: <b>${secondsLeft}s</b>`,
  ].join('\n');
}

function formatLeaderboard(): string {
  const rows = auctionService.getLeaderboard(10);
  if (rows.length === 0) {
    return 'No players on the leaderboard yet. Win an auction to claim the crown.';
  }

  return [
    '🏅 <b>Leaderboard</b>',
    '',
    ...rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.username)}</b> — wins: ${row.wins}, volume: ${row.total_volume.toFixed(2)} TON, bids: ${row.total_bids}`),
  ].join('\n');
}

export function registerAuctionHandlers(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '🤖 <b>AI Auction Arena</b>',
        '',
        'A Telegram-native auction where AI bidders fight for generated digital collectibles and you can jump in with TON-style bids.',
        '',
        'Commands:',
        '/newauction — start a fresh round',
        '/status — show the current live lot',
        '/bid 0.20 — place a bid in TON',
        '/leaderboard — show top human bidders',
        '/help — quick guide',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '🧠 <b>How it works</b>',
        '',
        '1. The bot generates a premium lot with OpenAI.',
        '2. AI bidders raise the price over time.',
        '3. You outbid them with /bid amount.',
        '4. Highest bid at the deadline wins.',
        '',
        'Example: <code>/bid 0.24</code>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('newauction', async (ctx) => {
    const snapshot = await auctionService.startAuction();
    await ctx.reply(`Auction ready: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`, { parse_mode: 'HTML' });
  });

  bot.command('status', async (ctx) => {
    await ctx.reply(formatStatus(), { parse_mode: 'HTML' });
  });

  bot.command('leaderboard', async (ctx) => {
    await ctx.reply(formatLeaderboard(), { parse_mode: 'HTML' });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
