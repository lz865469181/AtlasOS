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
	"github.com/user/feishu-ai-assistant/internal/types"
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

// cliResponse handles multiple Claude CLI output formats.
type cliResponse struct {
	Result    string          `json:"result"`
	Response  string          `json:"response"`
	Content   string          `json:"content"`
	ToolCalls json.RawMessage `json:"tool_use,omitempty"`
}

// parsedToolCall matches Claude CLI's tool_use output.
type parsedToolCall struct {
	Name  string            `json:"name"`
	Input map[string]string `json:"input"`
}

// Ask sends a message to Claude CLI with an optional system prompt.
// Returns the response including any tool calls.
func (a *ClaudeCLIAgent) Ask(ctx context.Context, message string, sess *session.Session) (*Response, error) {
	return a.AskWithSystemPrompt(ctx, message, "", sess)
}

// AskWithSystemPrompt sends a message with a system prompt to Claude CLI.
func (a *ClaudeCLIAgent) AskWithSystemPrompt(ctx context.Context, message, systemPrompt string, sess *session.Session) (*Response, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	timeout := a.cfg.TimeoutDuration()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := append([]string{}, a.cfg.ClaudeCLIArgs...)
	if systemPrompt != "" {
		args = append(args, "--system-prompt", systemPrompt)
	}
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
		return a.parseOutput(output), nil
	}
	return nil, fmt.Errorf("claude CLI failed after %d attempts: %v", a.cfg.MaxRetries+1, lastErr)
}

func (a *ClaudeCLIAgent) parseOutput(output string) *Response {
	var resp cliResponse
	if err := json.Unmarshal([]byte(output), &resp); err == nil {
		content := resp.Result
		if content == "" {
			content = resp.Response
		}
		if content == "" {
			content = resp.Content
		}

		r := &Response{Content: content}

		// Parse tool calls if present
		if len(resp.ToolCalls) > 0 {
			var toolCalls []parsedToolCall
			if json.Unmarshal(resp.ToolCalls, &toolCalls) == nil {
				for _, tc := range toolCalls {
					r.ToolCalls = append(r.ToolCalls, types.ToolCall{
						Tool:   tc.Name,
						Params: tc.Input,
					})
				}
			}
		}
		return r
	}

	// Plain text fallback
	return &Response{Content: output}
}

func (a *ClaudeCLIAgent) Reset() error  { return nil }
func (a *ClaudeCLIAgent) IsAlive() bool { return true }
func (a *ClaudeCLIAgent) Stop() error   { return nil }
func (a *ClaudeCLIAgent) Type() string  { return "claude-cli" }
func (a *ClaudeCLIAgent) ID() string    { return a.id }
