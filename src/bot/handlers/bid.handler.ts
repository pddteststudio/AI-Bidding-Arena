import { Bot, Context } from 'grammy';
import { auctionService } from '../../services/auction/auction.service';

export function registerBidHandlers(bot: Bot<Context>): void {
  bot.command('bid', async (ctx) => {
    const messageText = ctx.message?.text ?? '';
    const parts = messageText.trim().split(/\s+/);
    const amountRaw = parts[1];

    if (!amountRaw) {
      await ctx.reply('Usage: /bid 0.20');
      return;
    }

    const amount = Number(amountRaw.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      await ctx.reply('Bid amount must be a positive number. Example: /bid 0.20');
      return;
    }

    const bidderId = String(ctx.from?.id ?? 'unknown');
    const bidderName = ctx.from?.username
      ? `@${ctx.from.username}`
      : [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || `user_${bidderId}`;

    try {
      const result = await auctionService.placeUserBid(bidderId, bidderName, amount);
      await ctx.reply(
        [
          '✅ <b>Your bid is live</b>',
          '',
          `💰 Amount: <b>${amount.toFixed(2)} TON</b>`,
          `🧾 TX: <code>${result.txHash}</code>`,
          `🏁 You are the current leader for <b>${escapeHtml(result.snapshot.auction.lot_title)}</b>`,
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown bid error.';
      await ctx.reply(`❌ ${message}`);
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
