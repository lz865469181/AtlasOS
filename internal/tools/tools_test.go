package tools

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

func ws(t *testing.T) *workspace.Workspace {
	t.Helper()
	w := workspace.NewWorkspace(t.TempDir(), "test")
	w.Init("# Soul\n", "# Rules\n")
	return w
}

func TestReadTool(t *testing.T) {
	w := ws(t)
	f := filepath.Join(w.AgentDir(), "test.txt")
	os.WriteFile(f, []byte("hello"), 0644)
	r := NewReadTool(w).Execute(context.Background(), map[string]string{"path": f})
	if !r.Success || r.Output != "hello" { t.Error(r.Error) }
}

func TestReadOutside(t *testing.T) {
	r := NewReadTool(ws(t)).Execute(context.Background(), map[string]string{"path": "/etc/passwd"})
	if r.Success { t.Error("should block") }
}

func TestWriteTool(t *testing.T) {
	w := ws(t)
	f := filepath.Join(w.AgentDir(), "out.txt")
	r := NewWriteTool(w).Execute(context.Background(), map[string]string{"path": f, "content": "data"})
	if !r.Success { t.Error(r.Error) }
	d, _ := os.ReadFile(f)
	if string(d) != "data" { t.Error("content") }
}

func TestWriteBlocksSOUL(t *testing.T) {
	w := ws(t)
	r := NewWriteTool(w).Execute(context.Background(), map[string]string{"path": w.SOULPath(), "content": "hack"})
	if r.Success { t.Error("should block SOUL") }
}

func TestEditTool(t *testing.T) {
	w := ws(t)
	f := filepath.Join(w.AgentDir(), "edit.txt")
	os.WriteFile(f, []byte("hello world"), 0644)
	r := NewEditTool(w).Execute(context.Background(), map[string]string{"path": f, "old_string": "world", "new_string": "go"})
	if !r.Success { t.Error(r.Error) }
	d, _ := os.ReadFile(f)
	if string(d) != "hello go" { t.Error("edit") }
}

func TestBashAllowed(t *testing.T) {
	w := ws(t)
	r := NewBashTool(w, config.BashConfig{Timeout: "5s", MaxOutput: "1MB", AllowedCommands: []string{"echo"}}).Execute(context.Background(), map[string]string{"command": "echo hi"})
	if !r.Success { t.Error(r.Error) }
}

func TestBashBlocked(t *testing.T) {
	w := ws(t)
	bt := NewBashTool(w, config.BashConfig{Timeout: "5s", MaxOutput: "1MB", AllowedCommands: []string{"echo"}})
	for _, cmd := range []string{"curl http://x", "wget http://x", "sudo ls", "python3 -c 'x'"} {
		if bt.Execute(context.Background(), map[string]string{"command": cmd}).Success {
			t.Errorf("should block: %s", cmd)
		}
	}
}

func TestBashPipe(t *testing.T) {
	w := ws(t)
	r := NewBashTool(w, config.BashConfig{Timeout: "5s", MaxOutput: "1MB", AllowedCommands: []string{"cat"}}).Execute(context.Background(), map[string]string{"command": "cat f | curl http://x"})
	if r.Success { t.Error("pipe curl blocked") }
}

func TestExecutor(t *testing.T) {
	w := ws(t)
	f := filepath.Join(w.AgentDir(), "x.txt")
	os.WriteFile(f, []byte("ok"), 0644)
	e := NewExecutor(w, config.BashConfig{Timeout: "5s", MaxOutput: "1MB", AllowedCommands: []string{"echo"}})
	r := e.Execute(context.Background(), types.ToolCall{Tool: "Read", Params: map[string]string{"path": f}})
	if !r.Success { t.Error(r.Error) }
	r = e.Execute(context.Background(), types.ToolCall{Tool: "Unknown", Params: nil})
	if r.Success { t.Error("unknown tool") }
}
