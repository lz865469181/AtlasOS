package gateway

import (
	"testing"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/session"
)

func setup(t *testing.T) *CommandHandler {
	return NewCommandHandler(session.NewManager(session.NewMemoryStore(), 30*time.Minute))
}

func TestIsCommand(t *testing.T) {
	ch := setup(t)
	if !ch.IsCommand("/help") {
		t.Error("should be cmd")
	}
	if ch.IsCommand("hello") {
		t.Error("not cmd")
	}
}

func TestHelp(t *testing.T) {
	r := setup(t).Handle(channel.ChannelMessage{Content: "/help", Platform: "feishu", UserID: "u", ChatID: "c"})
	if r == "" {
		t.Error("empty help")
	}
	// Should now include /abort
	if !containsStr(r, "/abort") {
		t.Error("help should mention /abort")
	}
}

func TestReset(t *testing.T) {
	ch := setup(t)
	msg := channel.ChannelMessage{Content: "/reset", Platform: "feishu", UserID: "u", ChatID: "c"}
	ch.sm.GetOrCreate(msg, "a1")
	ch.Handle(msg)
	if _, ok := ch.sm.Get(session.SessionKey(msg)); ok {
		t.Error("should delete")
	}
}

func TestStatus(t *testing.T) {
	ch := setup(t)
	msg := channel.ChannelMessage{Content: "/status", Platform: "feishu", UserID: "u", ChatID: "c"}
	if ch.Handle(msg) != "No active session." {
		t.Error("no session")
	}
	ch.sm.GetOrCreate(msg, "a1")
	if ch.Handle(msg) == "No active session." {
		t.Error("should show status")
	}
}

func TestAbort(t *testing.T) {
	ch := setup(t)
	msg := channel.ChannelMessage{Content: "/branch test", Platform: "feishu", UserID: "u", ChatID: "c"}
	// Create session first
	ch.sm.GetOrCreate(msg, "a1")
	// Branch
	ch.Handle(msg)
	// Abort
	abortMsg := channel.ChannelMessage{Content: "/abort", Platform: "feishu", UserID: "u", ChatID: "c"}
	r := ch.Handle(abortMsg)
	if !containsStr(r, "Aborted") {
		t.Errorf("expected abort message, got: %s", r)
	}
}

func TestFeedback(t *testing.T) {
	ch := setup(t)
	msg := channel.ChannelMessage{Content: "/feedback", Platform: "feishu", UserID: "u", ChatID: "c"}
	ch.sm.GetOrCreate(msg, "a1")
	r := ch.Handle(msg)
	if !containsStr(r, "review") {
		t.Errorf("feedback should contain review info, got: %s", r)
	}
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
