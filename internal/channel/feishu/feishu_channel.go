package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/config"
)

// Channel implements channel.Channel using the official Feishu SDK with WebSocket long connection.
type Channel struct {
	cfg       config.ChannelConfig
	apiClient *lark.Client
	wsClient  *larkws.Client
	handler   channel.MessageHandler
	status    channel.ChannelStatus
	mu        sync.RWMutex
	stopChan  chan struct{}
}

func New(cfg config.ChannelConfig) *Channel {
	return &Channel{
		cfg:      cfg,
		stopChan: make(chan struct{}),
	}
}

func (c *Channel) Connect(ctx context.Context) error {
	c.mu.Lock()
	c.status = channel.StatusConnecting
	c.mu.Unlock()

	log.Printf("[feishu] connecting via official SDK (app_id: %s)", c.cfg.AppID)

	// Create API client for sending messages
	c.apiClient = lark.NewClient(c.cfg.AppID, c.cfg.AppSecret,
		lark.WithLogLevel(larkcore.LogLevelInfo),
		lark.WithEnableTokenCache(true),
	)

	// Create event dispatcher — empty strings for long connection mode
	eventHandler := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			c.handleMessageEvent(event)
			return nil
		})

	// Create WebSocket long connection client
	c.wsClient = larkws.NewClient(c.cfg.AppID, c.cfg.AppSecret,
		larkws.WithEventHandler(eventHandler),
		larkws.WithLogLevel(larkcore.LogLevelInfo),
	)

	// Start WebSocket client in a goroutine (cli.Start blocks)
	go func() {
		c.mu.Lock()
		c.status = channel.StatusConnected
		c.mu.Unlock()
		log.Println("[feishu] SDK WebSocket client starting...")

		err := c.wsClient.Start(ctx)
		if err != nil {
			log.Printf("[feishu] SDK WebSocket error: %v", err)
			c.mu.Lock()
			c.status = channel.StatusDisconnected
			c.mu.Unlock()
		}
	}()

	return nil
}

func (c *Channel) handleMessageEvent(event *larkim.P2MessageReceiveV1) {
	if c.handler == nil {
		return
	}

	ev := event.Event
	if ev == nil || ev.Message == nil {
		return
	}

	// Parse text content from message
	content := ""
	if ev.Message.Content != nil {
		var tc struct {
			Text string `json:"text"`
		}
		json.Unmarshal([]byte(*ev.Message.Content), &tc)
		content = tc.Text
	}
	if content == "" {
		return
	}

	// Determine if bot is mentioned
	mentionBot := false
	if ev.Message.Mentions != nil && len(ev.Message.Mentions) > 0 {
		mentionBot = true
	}

	// Extract fields safely
	userID := ""
	if ev.Sender != nil && ev.Sender.SenderId != nil && ev.Sender.SenderId.OpenId != nil {
		userID = *ev.Sender.SenderId.OpenId
	}
	userName := ""
	if ev.Sender != nil && ev.Sender.SenderType != nil {
		userName = *ev.Sender.SenderType
	}
	chatID := ""
	if ev.Message.ChatId != nil {
		chatID = *ev.Message.ChatId
	}
	chatType := ""
	if ev.Message.ChatType != nil {
		chatType = *ev.Message.ChatType
	}
	messageID := ""
	if ev.Message.MessageId != nil {
		messageID = *ev.Message.MessageId
	}
	messageType := ""
	if ev.Message.MessageType != nil {
		messageType = *ev.Message.MessageType
	}

	msg := channel.ChannelMessage{
		Platform:    "feishu",
		UserID:      userID,
		UserName:    userName,
		ChatID:      chatID,
		ChatType:    chatType,
		MessageID:   messageID,
		MessageType: messageType,
		Content:     content,
		MentionBot:  mentionBot,
		RawEvent:    event,
	}

	log.Printf("[feishu] received message from %s in %s: %s", userID, chatID, truncate(content, 50))
	c.handler(msg)
}

func (c *Channel) Disconnect() error {
	close(c.stopChan)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status = channel.StatusDisconnected
	log.Println("[feishu] disconnected")
	return nil
}

func (c *Channel) Reconnect(ctx context.Context) error {
	// SDK handles reconnection automatically
	log.Println("[feishu] reconnect requested (SDK handles this automatically)")
	return nil
}

func (c *Channel) OnMessage(h channel.MessageHandler) { c.handler = h }

func (c *Channel) SendReply(ctx context.Context, reply channel.ReplyMessage) error {
	if c.apiClient == nil {
		return fmt.Errorf("feishu API client not initialized")
	}

	var msgType, content string
	if reply.ContentType == "markdown" {
		msgType = "interactive"
		card, _ := json.Marshal(map[string]interface{}{
			"elements": []map[string]interface{}{
				{"tag": "markdown", "content": reply.Content},
			},
		})
		content = string(card)
	} else {
		msgType = "text"
		content = fmt.Sprintf(`{"text":"%s"}`, jsonEscape(reply.Content))
	}

	resp, err := c.apiClient.Im.Message.Create(ctx, larkim.NewCreateMessageReqBuilder().
		ReceiveIdType(larkim.ReceiveIdTypeChatId).
		Body(larkim.NewCreateMessageReqBodyBuilder().
			ReceiveId(reply.ChatID).
			MsgType(msgType).
			Content(content).
			Build()).
		Build())

	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	if !resp.Success() {
		return fmt.Errorf("send message error: code=%d msg=%s", resp.Code, resp.Msg)
	}

	log.Printf("[feishu] reply sent to %s", reply.ChatID)
	return nil
}

func (c *Channel) Type() string { return "feishu" }

func (c *Channel) Status() channel.ChannelStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.status
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}
