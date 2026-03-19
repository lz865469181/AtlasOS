package gateway

import (
	"context"
	"log"

	"github.com/user/feishu-ai-assistant/internal/agent"
	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/session"
)

type Router struct {
	commands     *CommandHandler
	sessionMgr   *session.Manager
	scheduler    *agent.Scheduler
	defaultAgent string
}

func NewRouter(cmd *CommandHandler, sm *session.Manager, sched *agent.Scheduler, defaultAgent string) *Router {
	return &Router{commands: cmd, sessionMgr: sm, scheduler: sched, defaultAgent: defaultAgent}
}

func (r *Router) HandleMessage(ctx context.Context, msg channel.ChannelMessage) channel.ReplyMessage {
	if r.commands.IsCommand(msg.Content) {
		return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: r.commands.Handle(msg), ContentType: "text"}
	}
	sess := r.sessionMgr.GetOrCreate(msg, r.defaultAgent)
	sess.AppendMessage(session.RoleUser, msg.Content)
	resp, err := r.scheduler.Dispatch(ctx, sess, msg.Content)
	if err != nil {
		log.Printf("[router] error: %v", err)
		return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: "Error processing request.", ContentType: "text"}
	}
	sess.AppendMessage(session.RoleAssistant, resp.Content)
	return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: resp.Content, ContentType: "markdown", SessionID: sess.ID}
}
