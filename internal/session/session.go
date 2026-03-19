package session

import (
	"sync"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel"
)

type SessionState int

const (
	StateActive    SessionState = iota
	StatePaused
	StateCompleted
	StateExpired
)

func (s SessionState) String() string {
	switch s {
	case StateActive:
		return "active"
	case StatePaused:
		return "paused"
	case StateCompleted:
		return "completed"
	case StateExpired:
		return "expired"
	default:
		return "unknown"
	}
}

type MessageRole string

const (
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
	RoleSystem    MessageRole = "system"
	RoleSummary   MessageRole = "summary"
)

type Message struct {
	Role      MessageRole       `json:"role"`
	Content   string            `json:"content"`
	Timestamp time.Time         `json:"timestamp"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type Session struct {
	ID          string                 `json:"id"`
	ParentID    string                 `json:"parent_id,omitempty"`
	BranchName  string                 `json:"branch_name"`
	Depth       int                    `json:"depth"`
	AgentID     string                 `json:"agent_id"`
	UserID      string                 `json:"user_id"`
	ChannelInfo channel.ChannelMessage `json:"channel_info"`
	Conversation []Message             `json:"conversation"`
	TokenCount   int                   `json:"token_count"`
	State       SessionState           `json:"state"`
	Children    []string               `json:"children,omitempty"`
	CreatedAt    time.Time             `json:"created_at"`
	LastActiveAt time.Time             `json:"last_active_at"`
	Summary      string                `json:"summary,omitempty"`
	mu sync.Mutex `json:"-"`
}

func NewSession(id, agentID, userID string, chanInfo channel.ChannelMessage) *Session {
	now := time.Now()
	return &Session{
		ID: id, BranchName: "main", AgentID: agentID, UserID: userID,
		ChannelInfo: chanInfo, Conversation: make([]Message, 0),
		State: StateActive, Children: make([]string, 0),
		CreatedAt: now, LastActiveAt: now,
	}
}

func (s *Session) Fork(childID, branchName string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	child := &Session{
		ID: childID, ParentID: s.ID, BranchName: branchName, Depth: s.Depth + 1,
		AgentID: s.AgentID, UserID: s.UserID, ChannelInfo: s.ChannelInfo,
		Conversation: make([]Message, 0), State: StateActive, Children: make([]string, 0),
		CreatedAt: time.Now(), LastActiveAt: time.Now(),
	}
	s.Children = append(s.Children, childID)
	s.State = StatePaused
	return child
}

func (s *Session) AppendMessage(role MessageRole, content string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Conversation = append(s.Conversation, Message{Role: role, Content: content, Timestamp: time.Now()})
	s.LastActiveAt = time.Now()
	s.TokenCount += estimateTokens(content)
}

func (s *Session) Complete(summary string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.State = StateCompleted
	s.Summary = summary
}

func (s *Session) Resume() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.State = StateActive
	s.LastActiveAt = time.Now()
}

func (s *Session) InjectSummary(childBranch, summary string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Conversation = append(s.Conversation, Message{
		Role: RoleSummary, Content: "[Side-quest: " + childBranch + "] " + summary,
		Timestamp: time.Now(), Metadata: map[string]string{"source": "branch_merge"},
	})
	s.TokenCount += estimateTokens(summary)
	s.LastActiveAt = time.Now()
}

func (s *Session) IsExpired(ttl time.Duration) bool {
	return time.Since(s.LastActiveAt) > ttl
}

func estimateTokens(text string) int {
	est := len([]rune(text)) / 2
	if est < 1 {
		return 1
	}
	return est
}
