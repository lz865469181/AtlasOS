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
		return "/reset — Reset session\n/help — This message\n/status — Session info\n/branch <name> — Fork side-quest\n/merge <summary> — Complete side-quest\n/feedback — Self-improvement"
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
	case "/feedback":
		return "Self-improvement review triggered."
	default:
		return fmt.Sprintf("Unknown command: %s. Type /help", parts[0])
	}
}
