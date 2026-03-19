package types

// ToolCall represents a tool invocation requested by the AI.
type ToolCall struct {
	Tool   string            `json:"tool"`
	Params map[string]string `json:"params"`
}

// ToolResult is the outcome of executing a tool call.
type ToolResult struct {
	Tool    string `json:"tool"`
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}
