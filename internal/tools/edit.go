package tools

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type EditTool struct{ workspace *workspace.Workspace }

func NewEditTool(ws *workspace.Workspace) *EditTool { return &EditTool{workspace: ws} }

func (t *EditTool) Execute(_ context.Context, params map[string]string) types.ToolResult {
	path, oldStr, newStr := params["path"], params["old_string"], params["new_string"]
	if path == "" || oldStr == "" {
		return types.ToolResult{Tool: "Edit", Success: false, Error: "missing path or old_string"}
	}
	if t.workspace.IsSOULPath(path) {
		return types.ToolResult{Tool: "Edit", Success: false, Error: "SOUL.md is immutable"}
	}
	if !t.workspace.IsPathInWorkspace(path) {
		return types.ToolResult{Tool: "Edit", Success: false, Error: fmt.Sprintf("path %q outside workspace", path)}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return types.ToolResult{Tool: "Edit", Success: false, Error: err.Error()}
	}
	content := string(data)
	if !strings.Contains(content, oldStr) {
		return types.ToolResult{Tool: "Edit", Success: false, Error: "old_string not found"}
	}
	count := strings.Count(content, oldStr)
	if params["replace_all"] == "true" {
		content = strings.ReplaceAll(content, oldStr, newStr)
	} else {
		if count > 1 {
			return types.ToolResult{Tool: "Edit", Success: false, Error: fmt.Sprintf("matches %d times; use replace_all=true", count)}
		}
		content = strings.Replace(content, oldStr, newStr, 1)
	}
	os.WriteFile(path, []byte(content), 0644)
	return types.ToolResult{Tool: "Edit", Success: true, Output: "replaced in " + path}
}
