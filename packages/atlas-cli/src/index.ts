import 'dotenv/config';
import { createApp } from './createApp.js';

const required = (name: string): string => {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
};

const app = createApp({
  feishuAppId: required('FEISHU_APP_ID'),
  feishuAppSecret: required('FEISHU_APP_SECRET'),
  agentCwd: process.env.AGENT_CWD ?? process.cwd(),
  agentEnv: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
});

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
