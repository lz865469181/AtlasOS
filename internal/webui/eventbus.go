package webui

import (
	"encoding/json"
	"sync"
	"time"
)

// EventType distinguishes log entries from chat messages.
type EventType string

const (
	EventLog     EventType = "log"
	EventMessage EventType = "message"
)

// Event is a single item pushed to the WebUI.
type Event struct {
	Type      EventType `json:"type"`
	Timestamp string    `json:"ts"`
	Level     string    `json:"level,omitempty"`
	Content   string    `json:"content,omitempty"`
	Direction string    `json:"direction,omitempty"`
	UserName  string    `json:"user_name,omitempty"`
	UserID    string    `json:"user_id,omitempty"`
	ChatID    string    `json:"chat_id,omitempty"`
	Platform  string    `json:"platform,omitempty"`
	Text      string    `json:"text,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
}

// Subscriber receives events via a channel.
type Subscriber struct {
	Ch   chan Event
	done chan struct{}
}

// EventBus holds a ring buffer of recent events and broadcasts to SSE subscribers.
type EventBus struct {
	mu          sync.RWMutex
	ring        []Event
	ringSize    int
	ringPos     int
	ringCount   int
	subscribers map[*Subscriber]struct{}
}

// NewEventBus creates an event bus with the given ring buffer size.
func NewEventBus(size int) *EventBus {
	if size <= 0 {
		size = 500
	}
	return &EventBus{
		ring:        make([]Event, size),
		ringSize:    size,
		subscribers: make(map[*Subscriber]struct{}),
	}
}

// Publish adds an event to the ring buffer and broadcasts to all subscribers.
func (eb *EventBus) Publish(e Event) {
	if e.Timestamp == "" {
		e.Timestamp = time.Now().Format(time.RFC3339Nano)
	}
	eb.mu.Lock()
	eb.ring[eb.ringPos] = e
	eb.ringPos = (eb.ringPos + 1) % eb.ringSize
	if eb.ringCount < eb.ringSize {
		eb.ringCount++
	}
	subs := make([]*Subscriber, 0, len(eb.subscribers))
	for s := range eb.subscribers {
		subs = append(subs, s)
	}
	eb.mu.Unlock()

	for _, s := range subs {
		select {
		case s.Ch <- e:
		default:
		}
	}
}

// Subscribe returns a Subscriber that receives future events.
func (eb *EventBus) Subscribe() *Subscriber {
	s := &Subscriber{
		Ch:   make(chan Event, 64),
		done: make(chan struct{}),
	}
	eb.mu.Lock()
	eb.subscribers[s] = struct{}{}
	eb.mu.Unlock()
	return s
}

// Unsubscribe removes a subscriber.
func (eb *EventBus) Unsubscribe(s *Subscriber) {
	eb.mu.Lock()
	delete(eb.subscribers, s)
	eb.mu.Unlock()
	close(s.done)
}

// Recent returns the last n events from the ring buffer (oldest first).
func (eb *EventBus) Recent(n int) []Event {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	if n > eb.ringCount {
		n = eb.ringCount
	}
	result := make([]Event, n)
	start := (eb.ringPos - n + eb.ringSize) % eb.ringSize
	for i := 0; i < n; i++ {
		result[i] = eb.ring[(start+i)%eb.ringSize]
	}
	return result
}

// RecentJSON returns Recent(n) as JSON bytes.
func (eb *EventBus) RecentJSON(n int) []byte {
	events := eb.Recent(n)
	data, _ := json.Marshal(events)
	return data
}

// PublishLog is a convenience method to publish a log event.
func (eb *EventBus) PublishLog(level, content string) {
	eb.Publish(Event{Type: EventLog, Level: level, Content: content})
}

// PublishMessage is a convenience method to publish a chat message event.
func (eb *EventBus) PublishMessage(direction, userName, userID, chatID, platform, text, sessionID string) {
	eb.Publish(Event{
		Type: EventMessage, Direction: direction,
		UserName: userName, UserID: userID, ChatID: chatID,
		Platform: platform, Text: text, SessionID: sessionID,
	})
}
