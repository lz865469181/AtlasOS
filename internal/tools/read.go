package tools

import (
	"context"
	"fmt"
	"os"

	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type ReadTool struct{ workspace *workspace.Workspace }

func NewReadTool(ws *workspace.Workspace) *ReadTool { return &ReadTool{workspace: ws} }

func (t *ReadTool) Execute(_ context.Context, params map[string]string) types.ToolResult {
	path := params["path"]
	if path == "" {
		return types.ToolResult{Tool: "Read", Success: false, Error: "missing 'path'"}
	}
	if !t.workspace.IsPathInWorkspace(path) {
		return types.ToolResult{Tool: "Read", Success: false, Error: fmt.Sprintf("path %q outside workspace", path)}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return types.ToolResult{Tool: "Read", Success: false, Error: err.Error()}
	}
	return types.ToolResult{Tool: "Read", Success: true, Output: string(data)}
}
