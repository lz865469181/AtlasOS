package feishu

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/user/feishu-ai-assistant/internal/channel"
)

type feishuEvent struct {
	Header struct {
		EventID   string `json:"event_id"`
		EventType string `json:"event_type"`
	} `json:"header"`
	Event struct {
		Sender struct {
			SenderID struct {
				OpenID string `json:"open_id"`
			} `json:"sender_id"`
		} `json:"sender"`
		Message struct {
			MessageID   string `json:"message_id"`
			ChatID      string `json:"chat_id"`
			ChatType    string `json:"chat_type"`
			MessageType string `json:"message_type"`
			Content     string `json:"content"`
			Mentions    []struct{ Key string } `json:"mentions"`
		} `json:"message"`
	} `json:"event"`
}

func ParseEvent(data []byte) (*channel.ChannelMessage, error) {
	var ev feishuEvent
	if err := json.Unmarshal(data, &ev); err != nil {
		return nil, err
	}
	content := ""
	if ev.Event.Message.Content != "" {
		var tc struct{ Text string `json:"text"` }
		json.Unmarshal([]byte(ev.Event.Message.Content), &tc)
		content = tc.Text
	}
	return &channel.ChannelMessage{
		Platform: "feishu", UserID: ev.Event.Sender.SenderID.OpenID,
		ChatID: ev.Event.Message.ChatID, ChatType: ev.Event.Message.ChatType,
		MessageID: ev.Event.Message.MessageID, MessageType: ev.Event.Message.MessageType,
		Content: content, MentionBot: len(ev.Event.Message.Mentions) > 0,
	}, nil
}

func SendTextMessage(token, chatID, content string) error {
	return sendMsg(token, chatID, "text", fmt.Sprintf(`{"text":"%s"}`, jsonEscape(content)))
}

func SendMarkdownMessage(token, chatID, content string) error {
	card, _ := json.Marshal(map[string]interface{}{
		"elements": []map[string]interface{}{{"tag": "markdown", "content": content}},
	})
	return sendMsg(token, chatID, "interactive", string(card))
}

func sendMsg(token, chatID, msgType, content string) error {
	body, _ := json.Marshal(map[string]interface{}{"receive_id": chatID, "msg_type": msgType, "content": content})
	req, _ := http.NewRequest("POST", "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var r struct{ Code int `json:"code"`; Msg string `json:"msg"` }
	json.Unmarshal(data, &r)
	if r.Code != 0 {
		return fmt.Errorf("send error: %d %s", r.Code, r.Msg)
	}
	return nil
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}
