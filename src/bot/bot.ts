import { Bot, Context } from 'grammy';
import { env } from '../config/env';
import { registerAuctionHandlers } from './handlers/auction.handler';
import { registerBidHandlers } from './handlers/bid.handler';
import { auctionService } from '../services/auction/auction.service';

export const bot = new Bot<Context>(env.botToken);
const subscriberChats = new Set<number>();

if (env.defaultChatId) {
  const parsed = Number(env.defaultChatId);
  if (Number.isFinite(parsed)) subscriberChats.add(parsed);
}

bot.use(async (ctx, next) => {
  if (ctx.chat?.id) {
    subscriberChats.add(Number(ctx.chat.id));
  }
  await next();
});

registerAuctionHandlers(bot);
registerBidHandlers(bot);

auctionService.subscribe(async (payload) => {
  for (const chatId of subscriberChats) {
    try {
      await bot.api.sendMessage(chatId, payload.text, {
        parse_mode: 'HTML',
        reply_markup: payload.replyMarkup,
      });
    } catch (error) {
      console.error(`Failed to broadcast to chat ${chatId}`, error);
    }
  }
});

bot.catch((error) => {
  console.error('Telegram bot error:', error.error);
});
