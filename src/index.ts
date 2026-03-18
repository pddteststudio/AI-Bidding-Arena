import { bot } from './bot/bot';
import { initDb } from './db/db';

async function bootstrap(): Promise<void> {
  initDb();
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
