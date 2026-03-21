import { Bot, Context } from 'grammy';
import { auctionService } from '../../services/auction/auction.service';

function formatStatus(): string {
  const live = auctionService.getLiveAuction();
  if (!live) {
    return 'No live auction right now. Start one with /newauction.';
  }

  const secondsLeft = Math.max(0, Math.ceil((new Date(live.ends_at).getTime() - Date.now()) / 1000));
  const nextMin = auctionService.getNextMinimumBid(live.current_price);

  return [
    '📡 <b>Live auction status</b>',
    '',
    `🖼 <b>${escapeHtml(live.lot_title)}</b>`,
    `💰 Current price: <b>${live.current_price.toFixed(2)} TON</b>`,
    `🧠 AI fair value: <b>${live.estimated_value_ton.toFixed(2)} TON</b>`,
    `🏁 Highest bidder: <b>${escapeHtml(live.highest_bidder_name ?? 'No bids yet')}</b>`,
    `📈 Next sensible bid: <b>${nextMin.toFixed(2)} TON+</b>`,
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
    ...rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.username)}</b>${row.entity_type === 'ai' ? ' 🤖' : ''} — wins: ${row.wins}, volume: ${row.total_volume.toFixed(2)} TON, bids: ${row.total_bids}`),
  ].join('\n');
}

export function registerAuctionHandlers(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '🤖 <b>AI Auction Arena</b>',
        '',
        'A Telegram-native auction where AI bidders fight for generated premium digital collectibles and you can jump in with TON-style bids.',
        '',
        'Commands:',
        '/newauction — start a fresh round',
        '/status — show the current live lot',
        '/bid 2500 — place a bid in TON',
        '/pay — show your pending TON invoice',
        '/leaderboard — show top bidders',
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
        '2. AI bidders decide whether the lot is still worth chasing.',
        '3. You outbid them with /bid amount.',
        '4. Highest bid at the deadline wins.',
        '5. If you win, you receive a TON payment button and can also use /pay.',
        '',
        'Example: <code>/bid 2500</code>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('newauction', async (ctx) => {
    const pending = await ctx.reply('🧠 Generating a new AI auction lot...');
    try {
      const snapshot = await auctionService.startAuction();
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, pending.message_id);
      } catch {
        // ignore cleanup failure
      }
      await ctx.reply(`Auction ready: <b>${escapeHtml(snapshot.auction.lot_title)}</b>`, { parse_mode: 'HTML' });
    } catch (error) {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, pending.message_id, `❌ ${error instanceof Error ? error.message : 'Failed to create auction.'}`);
      } catch {
        await ctx.reply(`❌ ${error instanceof Error ? error.message : 'Failed to create auction.'}`);
      }
    }
  });

  bot.command('status', async (ctx) => {
    await ctx.reply(formatStatus(), { parse_mode: 'HTML' });
  });

  bot.command('leaderboard', async (ctx) => {
    await ctx.reply(formatLeaderboard(), { parse_mode: 'HTML' });
  });

  bot.command('pay', async (ctx) => {
    const winnerId = String(ctx.from?.id ?? '');
    const settlement = auctionService.getPendingSettlementForWinner(winnerId);
    if (!settlement) {
      await ctx.reply('You do not have a pending TON payment right now.');
      return;
    }

    await ctx.reply(
      [
        '💎 <b>Your TON invoice</b>',
        '',
        `🏁 Winner: <b>${escapeHtml(settlement.winner_name)}</b>`,
        `💰 Amount: <b>${settlement.amount.toFixed(2)} TON</b>`,
        `📬 Address: <code>${escapeHtml(settlement.payment_address)}</code>`,
        `📝 Memo: <code>${escapeHtml(settlement.payment_memo)}</code>`,
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '💎 Pay with TON', url: settlement.payment_url }]],
        },
      },
    );
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
