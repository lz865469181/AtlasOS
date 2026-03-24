/**
 * Clarification mechanism — detects when Claude wants to ask the user
 * a clarifying question, converts it to a Feishu interactive card,
 * and waits for the user's selection before continuing.
 */

export interface ClarificationRequest {
  type: "missing_info" | "ambiguous_requirement" | "approach_choice" | "risk_confirmation" | "suggestion";
  question: string;
  context?: string;
  options?: string[];
}

const CLARIFICATION_REGEX = /\[CLARIFICATION_NEEDED\]\s*([\s\S]*?)\s*\[\/CLARIFICATION_NEEDED\]/;

/**
 * Parse a [CLARIFICATION_NEEDED] block from Claude's response.
 * Returns null if the response doesn't contain a clarification request.
 */
export function parseClarification(text: string): ClarificationRequest | null {
  const match = CLARIFICATION_REGEX.exec(text);
  if (!match) return null;

  const block = match[1];
  const typeMatch = /^type:\s*(.+)$/m.exec(block);
  const questionMatch = /^question:\s*(.+)$/m.exec(block);
  const contextMatch = /^context:\s*(.+)$/m.exec(block);
  const optionsMatch = /^options:\s*(.+)$/m.exec(block);

  if (!questionMatch) return null;

  const type = (typeMatch?.[1]?.trim() ?? "missing_info") as ClarificationRequest["type"];
  const question = questionMatch[1].trim();
  const context = contextMatch?.[1]?.trim();
  const options = optionsMatch?.[1]
    ?.split(/[,|]/)
    .map((o) => o.trim())
    .filter(Boolean);

  return { type, question, context, options };
}

/**
 * Strip the clarification block from Claude's response,
 * returning only the text outside the markers.
 */
export function stripClarification(text: string): string {
  return text.replace(CLARIFICATION_REGEX, "").trim();
}

const TYPE_META: Record<ClarificationRequest["type"], { icon: string; label: string; color: string }> = {
  missing_info:          { icon: "❓", label: "Need More Information",   color: "blue"   },
  ambiguous_requirement: { icon: "🤔", label: "Clarification Needed",   color: "purple" },
  approach_choice:       { icon: "🔀", label: "Choose an Approach",     color: "green"  },
  risk_confirmation:     { icon: "⚠️", label: "Confirm Before Proceed", color: "orange" },
  suggestion:            { icon: "💡", label: "Suggestion",             color: "blue"   },
};

/**
 * Build a Feishu interactive card for a clarification request.
 * The card displays the question and optional choices as buttons.
 */
export function buildClarificationCard(req: ClarificationRequest, sessionId: string): string {
  const meta = TYPE_META[req.type];

  let body = `${meta.icon} **${meta.label}**\n\n${req.question}`;
  if (req.context) {
    body += `\n\n> ${req.context}`;
  }

  const actions: unknown[] = [];

  if (req.options && req.options.length > 0) {
    for (const option of req.options) {
      actions.push({
        tag: "button",
        text: { tag: "plain_text", content: option },
        type: "default",
        value: {
          action: "clarification_reply",
          session_id: sessionId,
          reply: option,
        },
      });
    }
  }

  // Always add a "Reply manually" hint
  actions.push({
    tag: "button",
    text: { tag: "plain_text", content: "Skip (reply with text)" },
    type: "default",
    value: {
      action: "clarification_skip",
      session_id: sessionId,
    },
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${meta.icon} ${meta.label}` },
      template: meta.color,
    },
    elements: [
      { tag: "markdown", content: body },
      { tag: "hr" },
      { tag: "action", actions },
      {
        tag: "note",
        elements: [
          { tag: "plain_text", content: "Choose an option or reply with a text message to continue." },
        ],
      },
    ],
  };

  return JSON.stringify(card);
}
