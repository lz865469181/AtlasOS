package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/skill"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

func TestContextBuilder(t *testing.T) {
	ws := workspace.NewWorkspace(t.TempDir(), "ctx")
	ws.Init("# Soul\nI value truth.", "# Rules\nBe helpful.")
	ws.InitUser("u1")
	os.WriteFile(ws.UserMEMORYPath("u1"), []byte("## Prefs\n- Likes Go"), 0644)

	ctx, err := NewContextBuilder(ws).Build("u1", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Soul", "Rules", "Likes Go"} {
		if !strContains(ctx, want) {
			t.Errorf("missing: %s", want)
		}
	}
}

func TestContextBuilderWithSkills(t *testing.T) {
	ws := workspace.NewWorkspace(t.TempDir(), "sk")
	ws.Init("# Soul", "# Rules")
	sf := filepath.Join(ws.SkillsDir(), "test.md")
	os.WriteFile(sf, []byte("## Purpose\nDo useful stuff"), 0644)
	s := &skill.Skill{Name: "test", FilePath: sf, Meta: skill.Metadata{Status: skill.StatusStable}}
	ctx, _ := NewContextBuilder(ws).Build("", []*skill.Skill{s})
	if !strContains(ctx, "useful") {
		t.Error("missing skill content")
	}
}

func TestSchedulerCreate(t *testing.T) {
	sched := NewScheduler(config.AgentConfig{
		ClaudeCLIPath: "echo", Timeout: "5s", MaxConcurrentPerAgent: 5,
		WorkspaceRoot: t.TempDir(),
		Bash: config.BashConfig{Timeout: "5s", MaxOutput: "1MB", AllowedCommands: []string{"echo"}},
	})
	_, err := sched.CreateAgent("a1", "# Soul", "# Rules")
	if err != nil {
		t.Fatal(err)
	}
	if sched.AgentCount() != 1 {
		t.Error("count")
	}
	ag, ok := sched.GetAgent("a1")
	if !ok || ag.Type() != "claude-cli" {
		t.Error("get agent")
	}
	// Test GetInstance
	inst, ok := sched.GetInstance("a1")
	if !ok || inst.Workspace() == nil {
		t.Error("get instance")
	}
}

func strContains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
