package agent

import (
	"fmt"
	"os"
	"strings"

	"github.com/user/feishu-ai-assistant/internal/skill"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type ContextBuilder struct{ ws *workspace.Workspace }

func NewContextBuilder(ws *workspace.Workspace) *ContextBuilder {
	return &ContextBuilder{ws: ws}
}

func (cb *ContextBuilder) Build(userID string, skills []*skill.Skill) (string, error) {
	var parts []string
	if data, err := os.ReadFile(cb.ws.SOULPath()); err == nil {
		parts = append(parts, "--- SOUL ---\n"+string(data))
	} else {
		return "", fmt.Errorf("read SOUL.md: %w", err)
	}
	if data, err := os.ReadFile(cb.ws.AGENTSPath()); err == nil {
		parts = append(parts, "--- AGENTS ---\n"+string(data))
	}
	if userID != "" {
		if data, err := os.ReadFile(cb.ws.UserFilePath(userID)); err == nil {
			parts = append(parts, "--- USER ---\n"+string(data))
		}
		if data, err := os.ReadFile(cb.ws.UserMEMORYPath(userID)); err == nil {
			parts = append(parts, "--- MEMORY ---\n"+string(data))
		}
	}
	for _, s := range skills {
		if s.IsLoadable() {
			if data, err := os.ReadFile(s.FilePath); err == nil {
				parts = append(parts, fmt.Sprintf("--- Skill: %s ---\n%s", s.Name, string(data)))
			}
		}
	}
	return strings.Join(parts, "\n\n"), nil
}
