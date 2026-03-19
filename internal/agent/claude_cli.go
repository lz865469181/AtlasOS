package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/session"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type ClaudeCLIAgent struct {
	id  string
	cfg config.AgentConfig
	ws  *workspace.Workspace
	mu  sync.Mutex
}

func NewClaudeCLIAgent(id string, cfg config.AgentConfig, ws *workspace.Workspace) *ClaudeCLIAgent {
	return &ClaudeCLIAgent{id: id, cfg: cfg, ws: ws}
}

type cliResponse struct {
	Result   string `json:"result"`
	Response string `json:"response"`
	Content  string `json:"content"`
}

func (a *ClaudeCLIAgent) Ask(ctx context.Context, message string, sess *session.Session) (*Response, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	timeout := a.cfg.TimeoutDuration()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := append([]string{}, a.cfg.ClaudeCLIArgs...)
	args = append(args, "-p", message)

	var lastErr error
	for attempt := 0; attempt <= a.cfg.MaxRetries; attempt++ {
		cmd := exec.CommandContext(ctx, a.cfg.ClaudeCLIPath, args...)
		cmd.Dir = a.ws.AgentDir()
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr

		if err := cmd.Run(); err != nil {
			lastErr = err
			if ctx.Err() == context.DeadlineExceeded {
				return nil, fmt.Errorf("claude CLI timed out after %s", timeout)
			}
			continue
		}

		output := strings.TrimSpace(stdout.String())
		var resp cliResponse
		if json.Unmarshal([]byte(output), &resp) == nil {
			c := resp.Result
			if c == "" { c = resp.Response }
			if c == "" { c = resp.Content }
			if c != "" {
				return &Response{Content: c}, nil
			}
		}
		return &Response{Content: output}, nil
	}
	return nil, fmt.Errorf("claude CLI failed after %d attempts: %v", a.cfg.MaxRetries+1, lastErr)
}

func (a *ClaudeCLIAgent) Reset() error  { return nil }
func (a *ClaudeCLIAgent) IsAlive() bool { return true }
func (a *ClaudeCLIAgent) Stop() error   { return nil }
func (a *ClaudeCLIAgent) Type() string  { return "claude-cli" }
func (a *ClaudeCLIAgent) ID() string    { return a.id }
