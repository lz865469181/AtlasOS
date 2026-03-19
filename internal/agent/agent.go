package agent

import (
	"context"

	"github.com/user/feishu-ai-assistant/internal/session"
	"github.com/user/feishu-ai-assistant/internal/types"
)

type AgentStatus int

const (
	AgentReady AgentStatus = iota
	AgentBusy
	AgentError
)

type Response struct {
	Content    string            `json:"content"`
	ToolCalls  []types.ToolCall  `json:"tool_calls,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	TokensUsed int               `json:"tokens_used,omitempty"`
}

type Agent interface {
	Ask(ctx context.Context, message string, sess *session.Session) (*Response, error)
	Reset() error
	IsAlive() bool
	Stop() error
	Type() string
	ID() string
}
