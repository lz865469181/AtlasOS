package tools

import (
	"context"
	"fmt"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type Executor struct {
	readTool  *ReadTool
	writeTool *WriteTool
	editTool  *EditTool
	bashTool  *BashTool
}

func NewExecutor(ws *workspace.Workspace, bashCfg config.BashConfig) *Executor {
	return &Executor{
		readTool:  NewReadTool(ws),
		writeTool: NewWriteTool(ws),
		editTool:  NewEditTool(ws),
		bashTool:  NewBashTool(ws, bashCfg),
	}
}

func (e *Executor) Execute(ctx context.Context, call types.ToolCall) types.ToolResult {
	switch call.Tool {
	case "Read":
		return e.readTool.Execute(ctx, call.Params)
	case "Write":
		return e.writeTool.Execute(ctx, call.Params)
	case "Edit":
		return e.editTool.Execute(ctx, call.Params)
	case "Bash":
		return e.bashTool.Execute(ctx, call.Params)
	default:
		return types.ToolResult{Tool: call.Tool, Success: false, Error: fmt.Sprintf("unknown tool: %s", call.Tool)}
	}
}
