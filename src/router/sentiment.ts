/**
 * Pick a Feishu emoji reaction based on the sentiment of reply text.
 * Falls back to "THUMBSUP" for neutral/unmatched content.
 */

interface SentimentRule {
  emoji: string;
  patterns: RegExp[];
}

const rules: SentimentRule[] = [
  {
    emoji: "TADA",
    patterns: [
      /恭喜|祝贺|太棒了|成功|完成了|搞定|celebrate|congrat|awesome|well done|great job/i,
    ],
  },
  {
    emoji: "JOY",
    patterns: [
      /哈哈|😂|😄|搞笑|有趣|笑|幽默|haha|lol|funny|hilarious|joke/i,
    ],
  },
  {
    emoji: "CRY",
    patterns: [
      /抱歉|遗憾|可惜|难过|不幸|sorry|unfortunat|sadly|regret|无法|不能满足/i,
    ],
  },
  {
    emoji: "OPENMOUTH",
    patterns: [
      /惊|wow|amazing|incredible|unbelievable|没想到|居然|竟然|厉害/i,
    ],
  },
  {
    emoji: "CLAP",
    patterns: [
      /不错|很好|优秀|出色|棒|赞|good|nice|excellent|bravo|impressive|well/i,
    ],
  },
  {
    emoji: "THUMBSUP",
    patterns: [
      /可以|没问题|当然|好的|是的|sure|yes|of course|absolutely|certainly|okay/i,
    ],
  },
];

export function pickReactionEmoji(text: string): string {
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return rule.emoji;
      }
    }
  }
  return "THUMBSUP";
}
