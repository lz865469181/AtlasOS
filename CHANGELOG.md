# Changelog

## 2026-03-20

### feat: sentiment-based emoji reactions

Replace fixed emoji reactions with sentiment-aware responses based on reply content.

**Changes:**

- `src/router/sentiment.ts` (new): Sentiment analysis module that picks a Feishu emoji based on reply text keywords
  - `TADA` — celebration/success (恭喜, 太棒了, congrats...)
  - `JOY` — humor (哈哈, funny, lol...)
  - `CRY` — apology/regret (抱歉, sorry, 无法...)
  - `OPENMOUTH` — surprise (惊, wow, 没想到...)
  - `CLAP` — praise (不错, excellent, impressive...)
  - `THUMBSUP` — affirmative (可以, sure, 好的...)
  - Default fallback: `THUMBSUP`
- `src/router/router.ts`:
  - Initial reaction changed from `PROCESSING` to `THINKING`
  - Slash command completion reaction changed from `DONE` to `THUMBSUP`
  - Reply completion reaction changed from `DONE` to sentiment-based emoji via `pickReactionEmoji(reply)`
