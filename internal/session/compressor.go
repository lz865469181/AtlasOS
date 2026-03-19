package session

import (
	"fmt"
	"strings"
)

type Compressor struct {
	threshold float64
	maxTokens int
}

func NewCompressor(threshold float64, maxTokens int) *Compressor {
	if maxTokens == 0 {
		maxTokens = 100000
	}
	return &Compressor{threshold: threshold, maxTokens: maxTokens}
}

func (c *Compressor) NeedsCompression(sess *Session) bool {
	return sess.TokenCount > int(float64(c.maxTokens)*c.threshold)
}

func (c *Compressor) CompressPrompt(messages []Message) string {
	var sb strings.Builder
	sb.WriteString("Summarize this conversation preserving key decisions, facts, preferences, and pending tasks. Be concise, use bullet points.\n\nConversation:\n")
	for _, m := range messages {
		sb.WriteString(fmt.Sprintf("[%s] %s\n", m.Role, m.Content))
	}
	return sb.String()
}

func (c *Compressor) Apply(sess *Session, summary string, keepRecent int) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	total := len(sess.Conversation)
	if total <= keepRecent {
		return
	}
	recent := sess.Conversation[total-keepRecent:]
	newConv := make([]Message, 0, 1+len(recent))
	newConv = append(newConv, Message{Role: RoleSummary, Content: "[Context Summary]\n" + summary, Metadata: map[string]string{"source": "auto_compression"}})
	newConv = append(newConv, recent...)
	sess.Conversation = newConv
	sess.TokenCount = estimateTokens(summary)
	for _, m := range recent {
		sess.TokenCount += estimateTokens(m.Content)
	}
}

func (c *Compressor) OldMessages(sess *Session, keepRecent int) []Message {
	if len(sess.Conversation) <= keepRecent {
		return nil
	}
	return sess.Conversation[:len(sess.Conversation)-keepRecent]
}
