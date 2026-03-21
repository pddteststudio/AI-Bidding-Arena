import { bot } from './bot/bot';
import { initDb } from './db/db';

async function bootstrap(): Promise<void> {
  initDb();

  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the bot and see commands' },
    { command: 'newauction', description: 'Start a new AI auction' },
    { command: 'status', description: 'Show current lot and live price' },
    { command: 'bid', description: 'Place a bid, example: /bid 1.25' },
    { command: 'pay', description: 'Open your pending TON invoice' },
    { command: 'leaderboard', description: 'Show top users and AI bidders' },
    { command: 'help', description: 'See how the auction works' },
  ]);

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot @${botInfo.username} is running.`);
    },
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);
  process.exit(1);
});
