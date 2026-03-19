package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type WriteTool struct{ workspace *workspace.Workspace }

func NewWriteTool(ws *workspace.Workspace) *WriteTool { return &WriteTool{workspace: ws} }

func (t *WriteTool) Execute(_ context.Context, params map[string]string) types.ToolResult {
	path, content := params["path"], params["content"]
	if path == "" {
		return types.ToolResult{Tool: "Write", Success: false, Error: "missing 'path'"}
	}
	if t.workspace.IsSOULPath(path) {
		return types.ToolResult{Tool: "Write", Success: false, Error: "SOUL.md is immutable"}
	}
	if !t.workspace.IsPathInWorkspace(path) {
		return types.ToolResult{Tool: "Write", Success: false, Error: fmt.Sprintf("path %q outside workspace", path)}
	}
	os.MkdirAll(filepath.Dir(path), 0755)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return types.ToolResult{Tool: "Write", Success: false, Error: err.Error()}
	}
	return types.ToolResult{Tool: "Write", Success: true, Output: fmt.Sprintf("wrote %d bytes", len(content))}
}
