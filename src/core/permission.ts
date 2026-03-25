import type { PlatformSender, InlineButtonSender, ReplyContext } from "./interfaces.js";
import type { AskQuestion } from "../agent/types.js";
import { CardBuilder, renderCardAsText, collectCardButtons } from "./cards.js";
import { supportsInlineButtons } from "../platform/types.js";
import { log } from "./logger.js";

const ALLOW_KEYWORDS = new Set(["y", "yes", "allow", "ok", "是", "允许", "同意", "好"]);
const DENY_KEYWORDS = new Set(["n", "no", "deny", "reject", "否", "拒绝", "不"]);
const APPROVE_ALL_KEYWORDS = new Set(["yesall", "yes all", "allow all", "全部允许", "always"]);

export function isAllowResponse(text: string): boolean {
  return ALLOW_KEYWORDS.has(text.trim().toLowerCase());
}

export function isDenyResponse(text: string): boolean {
  return DENY_KEYWORDS.has(text.trim().toLowerCase());
}

export function isApproveAllResponse(text: string): boolean {
  return APPROVE_ALL_KEYWORDS.has(text.trim().toLowerCase());
}

export function buildPermissionCard(tool: string, input: string, questions?: AskQuestion[]) {
  const builder = new CardBuilder()
    .title("Permission Request", "orange")
    .markdown(`**Tool:** \`${tool}\`\n\n**Input:**\n\`\`\`\n${input.slice(0, 500)}\n\`\`\``);

  if (questions && questions.length > 0) {
    for (const q of questions) {
      builder.markdown(`\n**${q.question}**`);
      if (q.options) {
        for (let i = 0; i < q.options.length; i++) {
          builder.listItem(`${i + 1}. ${q.options[i]}`);
        }
      }
    }
    builder.divider().note("Reply with an option number or type your answer.");
  } else {
    builder.divider().buttons([
      { text: "Allow", value: "perm:allow", type: "primary" },
      { text: "Deny", value: "perm:deny", type: "danger" },
      { text: "Allow All", value: "perm:allow_all" },
    ]).note("Allow this tool to run? 'Allow All' auto-approves future requests this session.");
  }

  return builder.build();
}

export async function sendPermissionPrompt(
  sender: PlatformSender,
  replyCtx: ReplyContext,
  tool: string,
  input: string,
  questions?: AskQuestion[],
): Promise<void> {
  const card = buildPermissionCard(tool, input, questions);
  const text = renderCardAsText(card);

  if (sender.sendInteractiveCard) {
    await sender.sendInteractiveCard(replyCtx.chatID, JSON.stringify(card));
  } else if (supportsInlineButtons(sender as any)) {
    const buttons = collectCardButtons(card);
    await (sender as any as InlineButtonSender).sendWithButtons(
      replyCtx.chatID, text,
      [buttons.map((b) => ({ text: b.text, value: b.value }))],
    );
  } else {
    await sender.sendText(replyCtx.chatID, text + "\n\nReply 'y' to allow, 'n' to deny, 'yes all' to allow all.");
  }
}
