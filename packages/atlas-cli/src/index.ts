import 'dotenv/config';
import { ConfigLoader } from 'atlas-gateway';
import { createApp } from './createApp.js';

// Load config from file → env → runtime
const config = await ConfigLoader.load();

// Validate at least one channel is configured
if (!config.channels.feishu && !config.channels.dingtalk) {
  console.error('At least one channel must be configured: set FEISHU_APP_ID/FEISHU_APP_SECRET or DINGTALK_APP_KEY/DINGTALK_APP_SECRET');
  process.exit(1);
}

const app = createApp(config);

await app.start();

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[atlas] Received shutdown signal');
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
