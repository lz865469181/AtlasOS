package tools

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type BashTool struct {
	workspace       *workspace.Workspace
	cfg             config.BashConfig
	blockedBinaries map[string]bool
	blockedPatterns []*regexp.Regexp
	allowedCommands map[string]bool
}

func NewBashTool(ws *workspace.Workspace, cfg config.BashConfig) *BashTool {
	bt := &BashTool{
		workspace: ws, cfg: cfg,
		blockedBinaries: make(map[string]bool),
		allowedCommands: make(map[string]bool),
	}
	for _, c := range cfg.BlockedCommands {
		bt.blockedBinaries[c] = true
	}
	for _, c := range []string{"curl", "wget", "nc", "ncat", "sudo", "su", "doas", "dd", "mkfs", "fdisk", "chmod", "chown"} {
		bt.blockedBinaries[c] = true
	}
	for _, p := range append(cfg.BlockedPatterns, `python[23]?\s+-[ce]`, `node\s+-e`, `ruby\s+-e`, `bash\s+-c`, `sh\s+-c`, `/dev/tcp`, `\beval\s`, `\bexec\s`) {
		if re, err := regexp.Compile(p); err == nil {
			bt.blockedPatterns = append(bt.blockedPatterns, re)
		}
	}
	for _, c := range cfg.AllowedCommands {
		bt.allowedCommands[c] = true
		if parts := strings.Fields(c); len(parts) > 0 {
			bt.allowedCommands[parts[0]] = true
		}
	}
	return bt
}

func (bt *BashTool) Execute(ctx context.Context, params map[string]string) types.ToolResult {
	command := params["command"]
	if command == "" {
		return types.ToolResult{Tool: "Bash", Success: false, Error: "missing 'command'"}
	}
	if err := bt.validate(command); err != nil {
		return types.ToolResult{Tool: "Bash", Success: false, Error: fmt.Sprintf("blocked: %v", err)}
	}
	timeout := bt.cfg.TimeoutDuration()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = bt.workspace.AgentDir()
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	out := stdout.String()
	if max := bt.cfg.MaxOutputBytes(); int64(len(out)) > max {
		out = out[:max] + "\n...[truncated]"
	}
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return types.ToolResult{Tool: "Bash", Success: false, Error: "timed out"}
		}
		return types.ToolResult{Tool: "Bash", Success: false, Output: out, Error: fmt.Sprintf("%v\n%s", err, stderr.String())}
	}
	return types.ToolResult{Tool: "Bash", Success: true, Output: out}
}

func (bt *BashTool) validate(command string) error {
	for _, re := range bt.blockedPatterns {
		if re.MatchString(command) {
			return fmt.Errorf("blocked pattern: %s", re.String())
		}
	}
	for _, sub := range bt.splitSubs(command) {
		sub = strings.TrimSpace(sub)
		if sub == "" {
			continue
		}
		parts := strings.Fields(sub)
		bin := parts[0]
		if bt.blockedBinaries[bin] {
			return fmt.Errorf("blocked: %s", bin)
		}
		if bin == "rm" {
			for _, a := range parts[1:] {
				if strings.Contains(a, "rf") || strings.Contains(a, "fr") || a == "/" {
					return fmt.Errorf("rm -rf blocked")
				}
			}
		}
		if bt.allowedCommands[bin] {
			continue
		}
		found := false
		for a := range bt.allowedCommands {
			if strings.HasPrefix(sub, a) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("not in allowlist: %s", bin)
		}
	}
	return nil
}

func (bt *BashTool) splitSubs(cmd string) []string {
	var result []string
	cur := ""
	runes := []rune(cmd)
	for i := 0; i < len(runes); i++ {
		switch runes[i] {
		case '|':
			result = append(result, cur)
			cur = ""
			if i+1 < len(runes) && runes[i+1] == '|' {
				i++
			}
		case '&':
			if i+1 < len(runes) && runes[i+1] == '&' {
				result = append(result, cur)
				cur = ""
				i++
			} else {
				cur += string(runes[i])
			}
		case ';':
			result = append(result, cur)
			cur = ""
		case '`':
			return []string{cmd}
		default:
			cur += string(runes[i])
		}
	}
	if cur != "" {
		result = append(result, cur)
	}
	return result
}
