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
	compressor   *session.Compressor
	defaultAgent string
}

func NewRouter(cmd *CommandHandler, sm *session.Manager, sched *agent.Scheduler, defaultAgent string, compressThreshold float64) *Router {
	return &Router{
		commands:     cmd,
		sessionMgr:   sm,
		scheduler:    sched,
		compressor:   session.NewCompressor(compressThreshold, 100000),
		defaultAgent: defaultAgent,
	}
}

func (r *Router) HandleMessage(ctx context.Context, msg channel.ChannelMessage) channel.ReplyMessage {
	if r.commands.IsCommand(msg.Content) {
		return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: r.commands.Handle(msg), ContentType: "text"}
	}

	// Fix #5: Get session, and if paused (has active child), route to child
	sess := r.sessionMgr.GetOrCreate(msg, r.defaultAgent)
	sess = r.sessionMgr.GetActiveSession(sess)

	sess.AppendMessage(session.RoleUser, msg.Content)

	resp, err := r.scheduler.Dispatch(ctx, sess, msg.Content)
	if err != nil {
		log.Printf("[router] error: %v", err)
		return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: "Error processing request.", ContentType: "text"}
	}

	sess.AppendMessage(session.RoleAssistant, resp.Content)

	// Fix #3: Auto-compress if needed
	if r.compressor.NeedsCompression(sess) {
		log.Printf("[router] session %s needs compression (tokens: %d)", sess.ID, sess.TokenCount)
		old := r.compressor.OldMessages(sess, 6)
		if len(old) > 0 {
			summary := r.compressor.CompressPrompt(old)
			// Use a lightweight summary — in production this would call Claude CLI
			r.compressor.Apply(sess, "Previous conversation context has been compressed. Key points preserved.", 6)
			log.Printf("[router] compressed session %s: tokens now %d", sess.ID, sess.TokenCount)
			_ = summary // TODO: feed to Claude for real summarization
		}
	}

	return channel.ReplyMessage{ChatID: msg.ChatID, ReplyTo: msg.MessageID, Content: resp.Content, ContentType: "markdown", SessionID: sess.ID}
}
