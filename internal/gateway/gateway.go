package gateway

import (
	"context"
	"log"
	"time"

	"github.com/user/feishu-ai-assistant/internal/agent"
	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/session"
)

type Gateway struct {
	cfg        config.Config
	sessionMgr *session.Manager
	scheduler  *agent.Scheduler
	commands   *CommandHandler
	router     *Router
	wsServer   *WSServer
	channels   []channel.Channel
}

func New(cfg config.Config) *Gateway {
	store := session.NewMemoryStore()
	sm := session.NewManager(store, cfg.Gateway.SessionTTLDuration())
	sm.SetMaxSessions(cfg.Gateway.MaxSessions) // Fix: enforce MaxSessions
	sched := agent.NewScheduler(cfg.Agent)
	return &Gateway{cfg: cfg, sessionMgr: sm, scheduler: sched, commands: NewCommandHandler(sm)}
}

func (gw *Gateway) Start(ctx context.Context) error {
	if gw.scheduler.AgentCount() == 0 {
		gw.scheduler.CreateAgent("default", "# Default AI Assistant\n## Values\n- Be helpful and accurate\n", "# Rules\n- Follow instructions\n")
		log.Println("[gateway] created default agent")
	}
	gw.router = NewRouter(gw.commands, gw.sessionMgr, gw.scheduler, "default", gw.cfg.Gateway.ContextCompressThreshold)
	gw.sessionMgr.StartCleanupLoop(5 * time.Minute)
	gw.wsServer = NewWSServer(gw.cfg.Gateway.Address(), gw.router)
	log.Printf("[gateway] starting ws://%s", gw.cfg.Gateway.Address())
	go func() {
		if err := gw.wsServer.Start(); err != nil {
			log.Printf("[gateway] WS server stopped: %v", err)
		}
	}()
	return nil
}

func (gw *Gateway) RegisterChannel(ch channel.Channel) {
	gw.channels = append(gw.channels, ch)
	ch.OnMessage(func(msg channel.ChannelMessage) {
		// Fix: @bot filter — in group chats, only respond if bot is mentioned
		if msg.ChatType == "group" && !msg.MentionBot {
			return
		}
		reply := gw.router.HandleMessage(context.Background(), msg)
		ch.SendReply(context.Background(), reply)
	})
}

func (gw *Gateway) Stop() {
	log.Println("[gateway] shutting down...")
	for _, ch := range gw.channels {
		ch.Disconnect()
	}
	// Fix: graceful WebSocket shutdown
	if gw.wsServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		gw.wsServer.Shutdown(ctx)
	}
	gw.sessionMgr.Stop()
	log.Println("[gateway] stopped")
}

func (gw *Gateway) SessionManager() *session.Manager { return gw.sessionMgr }
func (gw *Gateway) Scheduler() *agent.Scheduler       { return gw.scheduler }
