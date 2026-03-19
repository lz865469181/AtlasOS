package feishu

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/user/feishu-ai-assistant/internal/channel"
	"github.com/user/feishu-ai-assistant/internal/config"
)

type Channel struct {
	cfg      config.ChannelConfig
	tokenMgr *TokenManager
	conn     *websocket.Conn
	handler  channel.MessageHandler
	status   channel.ChannelStatus
	mu       sync.RWMutex
	stopChan chan struct{}
	seen     sync.Map
}

func New(cfg config.ChannelConfig) *Channel {
	return &Channel{cfg: cfg, tokenMgr: NewTokenManager(cfg.AppID, cfg.AppSecret), stopChan: make(chan struct{})}
}

func (c *Channel) Connect(ctx context.Context) error {
	c.mu.Lock()
	c.status = channel.StatusConnecting
	c.mu.Unlock()
	log.Printf("[feishu] connecting to %s", c.cfg.WSEndpoint)
	c.tokenMgr.GetToken()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, c.cfg.WSEndpoint, nil)
	if err != nil {
		c.mu.Lock()
		c.status = channel.StatusDisconnected
		c.mu.Unlock()
		return err
	}
	c.mu.Lock()
	c.conn = conn
	c.status = channel.StatusConnected
	c.mu.Unlock()
	log.Println("[feishu] connected")
	go c.readLoop()
	return nil
}

func (c *Channel) Disconnect() error {
	close(c.stopChan)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.status = channel.StatusDisconnected
	return nil
}

func (c *Channel) Reconnect(ctx context.Context) error {
	c.mu.Lock()
	c.status = channel.StatusReconnecting
	if c.conn != nil { c.conn.Close() }
	c.mu.Unlock()
	for i := 0; i < 10; i++ {
		wait := time.Duration(1<<uint(i)) * time.Second
		if wait > 60*time.Second { wait = 60 * time.Second }
		time.Sleep(wait)
		if err := c.Connect(ctx); err == nil {
			return nil
		}
	}
	return nil
}

func (c *Channel) OnMessage(h channel.MessageHandler) { c.handler = h }

func (c *Channel) SendReply(ctx context.Context, reply channel.ReplyMessage) error {
	token, err := c.tokenMgr.GetToken()
	if err != nil {
		return err
	}
	if reply.ContentType == "markdown" {
		return SendMarkdownMessage(token, reply.ChatID, reply.Content)
	}
	return SendTextMessage(token, reply.ChatID, reply.Content)
}

func (c *Channel) Type() string { return "feishu" }
func (c *Channel) Status() channel.ChannelStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.status
}

func (c *Channel) readLoop() {
	for {
		select {
		case <-c.stopChan:
			return
		default:
		}
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			go c.Reconnect(context.Background())
			return
		}
		var hdr struct {
		Header struct {
			EventID   string `json:"event_id"`
			EventType string `json:"event_type"`
		} `json:"header"`
	}
		json.Unmarshal(data, &hdr)
		if hdr.Header.EventID != "" {
			if _, dup := c.seen.LoadOrStore(hdr.Header.EventID, true); dup {
				continue
			}
		}
		if hdr.Header.EventType != "im.message.receive_v1" {
			continue
		}
		msg, err := ParseEvent(data)
		if err != nil || msg.Content == "" {
			continue
		}
		if c.handler != nil {
			c.handler(*msg)
		}
	}
}
