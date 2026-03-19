package channel

import "context"

type ChannelStatus int

const (
	StatusDisconnected ChannelStatus = iota
	StatusConnecting
	StatusConnected
	StatusReconnecting
)

func (s ChannelStatus) String() string {
	switch s {
	case StatusDisconnected:
		return "disconnected"
	case StatusConnecting:
		return "connecting"
	case StatusConnected:
		return "connected"
	case StatusReconnecting:
		return "reconnecting"
	default:
		return "unknown"
	}
}

type ChannelMessage struct {
	Platform    string      `json:"platform"`
	UserID      string      `json:"user_id"`
	UserName    string      `json:"user_name"`
	ChatID      string      `json:"chat_id"`
	ChatType    string      `json:"chat_type"`
	MessageID   string      `json:"message_id"`
	MessageType string      `json:"message_type"`
	Content     string      `json:"content"`
	MentionBot  bool        `json:"mention_bot"`
	RawEvent    interface{} `json:"raw_event"`
	Timestamp   int64       `json:"timestamp"`
}

type ReplyMessage struct {
	ChatID      string `json:"chat_id"`
	ReplyTo     string `json:"reply_to"`
	Content     string `json:"content"`
	ContentType string `json:"content_type"`
	SessionID   string `json:"session_id"`
}

type MessageHandler func(msg ChannelMessage)

type Channel interface {
	Connect(ctx context.Context) error
	Disconnect() error
	Reconnect(ctx context.Context) error
	OnMessage(handler MessageHandler)
	SendReply(ctx context.Context, reply ReplyMessage) error
	Type() string
	Status() ChannelStatus
}
