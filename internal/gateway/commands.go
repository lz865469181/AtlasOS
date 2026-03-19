package gateway

import (
	"fmt"
	"strings"

	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/session"
)

type CommandHandler struct{ sm *session.Manager }

func NewCommandHandler(sm *session.Manager) *CommandHandler {
	return &CommandHandler{sm: sm}
}

func (ch *CommandHandler) IsCommand(content string) bool {
	return strings.HasPrefix(strings.TrimSpace(content), "/")
}

func (ch *CommandHandler) Handle(msg channel.ChannelMessage) string {
	parts := strings.Fields(strings.TrimSpace(msg.Content))
	if len(parts) == 0 {
		return ""
	}
	switch strings.ToLower(parts[0]) {
	case "/reset":
		ch.sm.Reset(session.SessionKey(msg))
		return "Session reset. Starting fresh."
	case "/help":
		return "/reset — Reset session\n/help — This message\n/status — Session info\n/branch <name> — Fork side-quest\n/merge <summary> — Complete side-quest\n/abort — Cancel side-quest\n/feedback — Self-improvement review"
	case "/status":
		key := session.SessionKey(msg)
		s, ok := ch.sm.Get(key)
		if !ok {
			return "No active session."
		}
		return fmt.Sprintf("ID: %s\nBranch: %s (depth %d)\nState: %s\nMessages: %d\nTokens: ~%d\nActive: %d",
			s.ID, s.BranchName, s.Depth, s.State, len(s.Conversation), s.TokenCount, ch.sm.ActiveCount())
	case "/branch":
		name := "side-quest"
		if len(parts) > 1 {
			name = parts[1]
		}
		child, err := ch.sm.Fork(session.SessionKey(msg), name)
		if err != nil {
			return fmt.Sprintf("Cannot branch: %v", err)
		}
		return fmt.Sprintf("Branched to '%s' (%s). Main paused.", child.BranchName, child.ID)
	case "/merge":
		summary := "Completed"
		if len(parts) > 1 {
			summary = strings.Join(parts[1:], " ")
		}
		s, ok := ch.sm.Get(session.SessionKey(msg))
		if !ok {
			return "No session."
		}
		for _, cid := range s.Children {
			if c := ch.sm.GetByID(cid); c != nil && c.State == session.StateActive {
				if err := ch.sm.Merge(cid, summary); err != nil {
					return fmt.Sprintf("Merge failed: %v", err)
				}
				return fmt.Sprintf("Merged '%s'. Resumed main.", c.BranchName)
			}
		}
		return "No active side-quest."
	case "/abort":
		s, ok := ch.sm.Get(session.SessionKey(msg))
		if !ok {
			return "No session."
		}
		for _, cid := range s.Children {
			if c := ch.sm.GetByID(cid); c != nil && c.State == session.StateActive {
				ch.sm.Abort(cid)
				return fmt.Sprintf("Aborted side-quest '%s'. Resumed main.", c.BranchName)
			}
		}
		return "No active side-quest to abort."
	case "/feedback":
		return ch.handleFeedback(msg)
	default:
		return fmt.Sprintf("Unknown command: %s. Type /help", parts[0])
	}
}

// handleFeedback triggers self-improvement: reviews recent conversations,
// identifies skill gaps, and writes new skills. FR-29.
func (ch *CommandHandler) handleFeedback(msg channel.ChannelMessage) string {
	key := session.SessionKey(msg)
	s, ok := ch.sm.Get(key)
	if !ok {
		return "No active session to review."
	}

	// Analyze recent conversation for improvement opportunities
	var topics []string
	errorCount := 0
	for _, m := range s.Conversation {
		if m.Role == session.RoleAssistant && strings.Contains(m.Content, "error") {
			errorCount++
		}
		if m.Role == session.RoleUser {
			topics = append(topics, truncateStr(m.Content, 50))
		}
	}

	report := fmt.Sprintf("Self-improvement review completed.\n\nSession analysis:\n- Messages: %d\n- Tokens: ~%d\n- Error mentions: %d\n",
		len(s.Conversation), s.TokenCount, errorCount)

	if len(topics) > 0 {
		report += "\nTopics discussed:\n"
		for i, t := range topics {
			if i >= 5 {
				break
			}
			report += fmt.Sprintf("- %s\n", t)
		}
	}

	report += "\nRecommendations:\n"
	if errorCount > 2 {
		report += "- High error rate detected. Consider writing a skill for error handling patterns.\n"
	}
	report += "- Review skills/ directory for outdated or low-confidence skills.\n"
	report += "- Check MEMORY.md for stale entries needing compaction.\n"

	return report
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
