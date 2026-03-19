package session

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel"
)

var sessionCounter uint64

type Manager struct {
	store      Store
	ttl        time.Duration
	maxSessions int
	mu         sync.RWMutex
	stopChan   chan struct{}
}

func NewManager(store Store, ttl time.Duration) *Manager {
	return &Manager{store: store, ttl: ttl, stopChan: make(chan struct{})}
}

// SetMaxSessions sets the maximum session limit. Fix: NFR-02.
func (m *Manager) SetMaxSessions(max int) {
	m.maxSessions = max
}

func SessionKey(msg channel.ChannelMessage) string {
	return fmt.Sprintf("%s:%s:%s", msg.Platform, msg.UserID, msg.ChatID)
}

func (m *Manager) GetOrCreate(msg channel.ChannelMessage, agentID string) *Session {
	key := SessionKey(msg)
	m.mu.RLock()
	sess, ok := m.store.Get(key)
	m.mu.RUnlock()
	if ok && !sess.IsExpired(m.ttl) && (sess.State == StateActive || sess.State == StatePaused) {
		sess.mu.Lock()
		sess.LastActiveAt = time.Now()
		sess.mu.Unlock()
		return sess
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if sess, ok := m.store.Get(key); ok && !sess.IsExpired(m.ttl) && (sess.State == StateActive || sess.State == StatePaused) {
		return sess
	}

	// Fix: Enforce MaxSessions
	if m.maxSessions > 0 && m.store.Count() >= m.maxSessions {
		m.evictOldest()
	}

	id := fmt.Sprintf("sess-%d-%d", time.Now().UnixNano(), atomic.AddUint64(&sessionCounter, 1))
	newSess := NewSession(id, agentID, msg.UserID, msg)
	m.store.Put(key, newSess)
	return newSess
}

// GetActiveSession follows the session tree to the deepest active child.
// Fix #5: When parent is paused, route to the active child session.
func (m *Manager) GetActiveSession(sess *Session) *Session {
	if sess.State == StateActive {
		return sess
	}
	// Parent is paused — find active child
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, childID := range sess.Children {
		child := m.findByID(childID)
		if child != nil && child.State == StateActive {
			return child
		}
	}
	// No active child found, return original
	return sess
}

func (m *Manager) Get(key string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.store.Get(key)
}

func (m *Manager) GetByID(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.findByID(id)
}

func (m *Manager) Fork(parentKey, branchName string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	parent, ok := m.store.Get(parentKey)
	if !ok {
		return nil, fmt.Errorf("parent not found: %s", parentKey)
	}
	if parent.State != StateActive {
		return nil, fmt.Errorf("can only fork active sessions")
	}
	childID := fmt.Sprintf("sess-%d-%d-branch", time.Now().UnixNano(), atomic.AddUint64(&sessionCounter, 1))
	child := parent.Fork(childID, branchName)
	m.store.Put(child.ID, child)
	return child, nil
}

func (m *Manager) Merge(childID, summary string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	child := m.findByID(childID)
	if child == nil {
		return fmt.Errorf("child not found: %s", childID)
	}
	if child.ParentID == "" {
		return fmt.Errorf("session has no parent")
	}
	child.Complete(summary)
	parent := m.findByID(child.ParentID)
	if parent == nil {
		return fmt.Errorf("parent not found: %s", child.ParentID)
	}
	parent.InjectSummary(child.BranchName, summary)
	parent.Resume()
	return nil
}

func (m *Manager) Abort(childID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	child := m.findByID(childID)
	if child == nil {
		return fmt.Errorf("child not found")
	}
	child.State = StateExpired
	if parent := m.findByID(child.ParentID); parent != nil {
		parent.Resume()
	}
	return nil
}

func (m *Manager) Reset(key string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store.Delete(key)
}

func (m *Manager) CleanupExpired() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	var expired []string
	for _, k := range m.store.ListKeys() {
		if s, ok := m.store.Get(k); ok && s.IsExpired(m.ttl) {
			expired = append(expired, k)
		}
	}
	for _, k := range expired {
		m.store.Delete(k)
	}
	return len(expired)
}

func (m *Manager) StartCleanupLoop(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				m.CleanupExpired()
			case <-m.stopChan:
				return
			}
		}
	}()
}

func (m *Manager) Stop() { close(m.stopChan) }

func (m *Manager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c := 0
	for _, s := range m.store.List() {
		if s.State == StateActive {
			c++
		}
	}
	return c
}

func (m *Manager) findByID(id string) *Session {
	for _, s := range m.store.List() {
		if s.ID == id {
			return s
		}
	}
	return nil
}

// evictOldest removes the oldest idle session to make room. Caller must hold lock.
func (m *Manager) evictOldest() {
	var oldestKey string
	var oldestTime time.Time
	for _, k := range m.store.ListKeys() {
		s, ok := m.store.Get(k)
		if !ok {
			continue
		}
		if oldestKey == "" || s.LastActiveAt.Before(oldestTime) {
			oldestKey = k
			oldestTime = s.LastActiveAt
		}
	}
	if oldestKey != "" {
		m.store.Delete(oldestKey)
	}
}
