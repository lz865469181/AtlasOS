package session

import (
	"testing"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel"
)

func testMsg(uid, cid string) channel.ChannelMessage {
	return channel.ChannelMessage{Platform: "feishu", UserID: uid, ChatID: cid}
}
func newTestSession() *Session {
	return NewSession("s1", "a1", "u1", testMsg("u1", "c1"))
}

func TestNewSession(t *testing.T) {
	s := newTestSession()
	if s.BranchName != "main" || s.Depth != 0 || s.State != StateActive { t.Error("defaults") }
}

func TestFork(t *testing.T) {
	p := newTestSession()
	c := p.Fork("s2", "fix-tool")
	if c.ParentID != "s1" || c.Depth != 1 || c.State != StateActive { t.Error("child") }
	if p.State != StatePaused || len(p.Children) != 1 { t.Error("parent") }
	if len(c.Conversation) != 0 { t.Error("child should not inherit conversation") }
}

func TestCompleteAndResume(t *testing.T) {
	p := newTestSession()
	c := p.Fork("s2", "quest")
	c.Complete("done")
	if c.State != StateCompleted { t.Error("child state") }
	p.InjectSummary(c.BranchName, c.Summary)
	p.Resume()
	if p.State != StateActive { t.Error("parent state") }
	if p.Conversation[len(p.Conversation)-1].Role != RoleSummary { t.Error("summary") }
}

func TestIsExpired(t *testing.T) {
	s := newTestSession()
	s.LastActiveAt = time.Now().Add(-1 * time.Hour)
	if !s.IsExpired(30 * time.Minute) { t.Error("should expire") }
}

func TestManagerGetOrCreate(t *testing.T) {
	mgr := NewManager(NewMemoryStore(), 30*time.Minute)
	s1 := mgr.GetOrCreate(testMsg("u1", "c1"), "a1")
	s2 := mgr.GetOrCreate(testMsg("u1", "c1"), "a1")
	if s1.ID != s2.ID { t.Error("same msg same session") }
	s3 := mgr.GetOrCreate(testMsg("u1", "c2"), "a1")
	if s3.ID == s1.ID { t.Error("diff chat diff session") }
}

func TestManagerForkMerge(t *testing.T) {
	mgr := NewManager(NewMemoryStore(), 30*time.Minute)
	msg := testMsg("u1", "c1")
	p := mgr.GetOrCreate(msg, "a1")
	child, _ := mgr.Fork(SessionKey(msg), "quest")
	mgr.Merge(child.ID, "fixed it")
	if p.State != StateActive { t.Error("parent resumed") }
}

func TestManagerCleanup(t *testing.T) {
	mgr := NewManager(NewMemoryStore(), 1*time.Millisecond)
	mgr.GetOrCreate(testMsg("u1", "c1"), "a1")
	time.Sleep(5 * time.Millisecond)
	if mgr.CleanupExpired() != 1 { t.Error("cleanup") }
}

func TestCompressor(t *testing.T) {
	comp := NewCompressor(0.8, 1000)
	s := newTestSession()
	for i := 0; i < 10; i++ { s.AppendMessage(RoleUser, "message") }
	comp.Apply(s, "summary of 7", 3)
	if len(s.Conversation) != 4 { t.Errorf("after compress: %d", len(s.Conversation)) }
	if s.Conversation[0].Role != RoleSummary { t.Error("first should be summary") }
}
