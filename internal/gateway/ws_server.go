package gateway

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/user/feishu-ai-assistant/internal/channel"
)

type WSServer struct {
	addr     string
	router   *Router
	upgrader websocket.Upgrader
	clients  sync.Map
}

func NewWSServer(addr string, router *Router) *WSServer {
	return &WSServer{addr: addr, router: router, upgrader: websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}}
}

type WSMessage struct {
	Type        string `json:"type"`
	Channel     string `json:"channel,omitempty"`
	UserID      string `json:"user_id,omitempty"`
	ChatID      string `json:"chat_id,omitempty"`
	ChatType    string `json:"chat_type,omitempty"`
	Content     string `json:"content,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	MessageID   string `json:"message_id,omitempty"`
	SessionID   string `json:"session_id,omitempty"`
	ReplyTo     string `json:"reply_to,omitempty"`
	Timestamp   int64  `json:"timestamp,omitempty"`
}

func (s *WSServer) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handle)
	mux.HandleFunc("/", s.handle)
	log.Printf("[ws] listening on %s", s.addr)
	return http.ListenAndServe(s.addr, mux)
}

func (s *WSServer) handle(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	s.clients.Store(conn, true)
	defer s.clients.Delete(conn)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var wsMsg WSMessage
		if json.Unmarshal(msg, &wsMsg) != nil {
			continue
		}
		if wsMsg.Type == "channel.message" {
			reply := s.router.HandleMessage(nil, channel.ChannelMessage{
				Platform: wsMsg.Channel, UserID: wsMsg.UserID, ChatID: wsMsg.ChatID,
				ChatType: wsMsg.ChatType, Content: wsMsg.Content, MessageID: wsMsg.MessageID,
			})
			data, _ := json.Marshal(WSMessage{
				Type: "gateway.reply", Channel: wsMsg.Channel, ChatID: reply.ChatID,
				ReplyTo: reply.ReplyTo, Content: reply.Content, ContentType: reply.ContentType, SessionID: reply.SessionID,
			})
			conn.WriteMessage(websocket.TextMessage, data)
		}
	}
}
