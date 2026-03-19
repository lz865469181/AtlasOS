package agent

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/memory"
	"github.com/user/feishu-ai-assistant/internal/session"
	"github.com/user/feishu-ai-assistant/internal/skill"
	"github.com/user/feishu-ai-assistant/internal/tools"
	"github.com/user/feishu-ai-assistant/internal/types"
	"github.com/user/feishu-ai-assistant/internal/workspace"
)

type Scheduler struct {
	cfg    config.AgentConfig
	agents map[string]*agentInstance
	mu     sync.RWMutex
}

type agentInstance struct {
	agent   Agent
	ws      *workspace.Workspace
	ctx     *ContextBuilder
	skills  *skill.Loader
	tools   *tools.Executor
	log     *memory.DailyLog
	active  int32 // use atomic operations
}

func NewScheduler(cfg config.AgentConfig) *Scheduler {
	return &Scheduler{cfg: cfg, agents: make(map[string]*agentInstance)}
}

func (s *Scheduler) RegisterAgent(ag Agent, ws *workspace.Workspace) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents[ag.ID()] = &agentInstance{
		agent:  ag,
		ws:     ws,
		ctx:    NewContextBuilder(ws),
		skills: skill.NewLoader(ws.SkillsDir()),
		tools:  tools.NewExecutor(ws, s.cfg.Bash),
		log:    memory.NewDailyLog(ws.MemoryDir()),
	}
}

func (s *Scheduler) CreateAgent(id, soul, agents string) (Agent, error) {
	ws := workspace.NewWorkspace(s.cfg.WorkspaceRoot, id)
	if err := ws.Init(soul, agents); err != nil {
		return nil, fmt.Errorf("init workspace: %w", err)
	}
	ag := NewClaudeCLIAgent(id, s.cfg, ws)
	s.RegisterAgent(ag, ws)
	return ag, nil
}

// Dispatch sends a message to the agent with full context and tool execution loop.
func (s *Scheduler) Dispatch(ctx context.Context, sess *session.Session, message string) (*Response, error) {
	s.mu.RLock()
	inst, ok := s.agents[sess.AgentID]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("agent not found: %s", sess.AgentID)
	}

	// Fix #6: atomic concurrency counter
	if atomic.LoadInt32(&inst.active) >= int32(s.cfg.MaxConcurrentPerAgent) {
		return &Response{Content: "I'm busy, please try again shortly."}, nil
	}
	atomic.AddInt32(&inst.active, 1)
	defer atomic.AddInt32(&inst.active, -1)

	inst.ws.InitUser(sess.UserID)

	// Fix #1: Build context and actually use it
	allSkills, _ := inst.skills.LoadAll()
	matched := inst.skills.MatchByKeywords(message, allSkills)
	systemPrompt, err := inst.ctx.Build(sess.UserID, matched)
	if err != nil {
		log.Printf("[scheduler] context build error: %v", err)
		systemPrompt = "" // degrade gracefully
	}

	// Invoke Claude CLI with system prompt
	cliAgent, ok := inst.agent.(*ClaudeCLIAgent)
	if !ok {
		return inst.agent.Ask(ctx, message, sess)
	}

	resp, err := cliAgent.AskWithSystemPrompt(ctx, message, systemPrompt, sess)
	if err != nil {
		return nil, err
	}

	// Fix #2: Tool execution loop — process tool calls from Claude response
	maxToolRounds := 5
	for round := 0; round < maxToolRounds && len(resp.ToolCalls) > 0; round++ {
		var results []types.ToolResult
		for _, tc := range resp.ToolCalls {
			result := inst.tools.Execute(ctx, tc)
			results = append(results, result)

			// Audit log for Bash executions (Fix: FR-55)
			if tc.Tool == "Bash" {
				status := "OK"
				if !result.Success {
					status = "BLOCKED"
				}
				inst.log.Append(fmt.Sprintf("Bash [%s]: %s → %s", status, tc.Params["command"], truncate(result.Output, 100)))
			}
		}

		// Feed tool results back to Claude CLI
		toolResultMsg := formatToolResults(results)
		resp, err = cliAgent.AskWithSystemPrompt(ctx, toolResultMsg, systemPrompt, sess)
		if err != nil {
			return nil, err
		}
	}

	return resp, nil
}

func (s *Scheduler) GetAgent(id string) (Agent, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	i, ok := s.agents[id]
	if !ok {
		return nil, false
	}
	return i.agent, true
}

func (s *Scheduler) GetInstance(id string) (*AgentInstanceView, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	i, ok := s.agents[id]
	if !ok {
		return nil, false
	}
	return &AgentInstanceView{ws: i.ws}, true
}

// AgentInstanceView provides read-only access to agent instance data.
type AgentInstanceView struct {
	ws *workspace.Workspace
}

func (v *AgentInstanceView) Workspace() *workspace.Workspace {
	return v.ws
}

func (s *Scheduler) ListAgents() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, 0, len(s.agents))
	for id := range s.agents {
		ids = append(ids, id)
	}
	return ids
}

func (s *Scheduler) AgentCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.agents)
}

func formatToolResults(results []types.ToolResult) string {
	var parts []string
	for _, r := range results {
		if r.Success {
			parts = append(parts, fmt.Sprintf("[Tool %s result]: %s", r.Tool, truncate(r.Output, 2000)))
		} else {
			parts = append(parts, fmt.Sprintf("[Tool %s error]: %s", r.Tool, r.Error))
		}
	}
	return fmt.Sprintf("Tool execution results:\n%s\n\nPlease continue based on these results.", joinLines(parts))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func joinLines(parts []string) string {
	result := ""
	for _, p := range parts {
		result += p + "\n"
	}
	return result
}
