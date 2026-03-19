package agent

import (
	"context"
	"fmt"
	"sync"

	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/session"
	"github.com/user/feishu-ai-assistant/internal/skill"
	"github.com/user/feishu-ai-assistant/internal/tools"
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
	active  int32
}

func NewScheduler(cfg config.AgentConfig) *Scheduler {
	return &Scheduler{cfg: cfg, agents: make(map[string]*agentInstance)}
}

func (s *Scheduler) RegisterAgent(ag Agent, ws *workspace.Workspace) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents[ag.ID()] = &agentInstance{
		agent: ag, ws: ws,
		ctx:    NewContextBuilder(ws),
		skills: skill.NewLoader(ws.SkillsDir()),
		tools:  tools.NewExecutor(ws, s.cfg.Bash),
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

func (s *Scheduler) Dispatch(ctx context.Context, sess *session.Session, message string) (*Response, error) {
	s.mu.RLock()
	inst, ok := s.agents[sess.AgentID]
	s.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("agent not found: %s", sess.AgentID)
	}
	if int(inst.active) >= s.cfg.MaxConcurrentPerAgent {
		return &Response{Content: "I'm busy, please try again shortly."}, nil
	}
	inst.active++
	defer func() { inst.active-- }()

	inst.ws.InitUser(sess.UserID)
	allSkills, _ := inst.skills.LoadAll()
	matched := inst.skills.MatchByKeywords(message, allSkills)
	_, _ = inst.ctx.Build(sess.UserID, matched) // system prompt built (used with --system-prompt in future)

	resp, err := inst.agent.Ask(ctx, message, sess)
	if err != nil {
		return nil, err
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
