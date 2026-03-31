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

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
