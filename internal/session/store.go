package session

import "sync"

type Store interface {
	Get(key string) (*Session, bool)
	Put(key string, sess *Session)
	Delete(key string)
	List() []*Session
	ListKeys() []string
	Count() int
}

type MemoryStore struct{ data sync.Map }

func NewMemoryStore() *MemoryStore { return &MemoryStore{} }

func (s *MemoryStore) Get(key string) (*Session, bool) {
	v, ok := s.data.Load(key)
	if !ok {
		return nil, false
	}
	return v.(*Session), true
}
func (s *MemoryStore) Put(key string, sess *Session) { s.data.Store(key, sess) }
func (s *MemoryStore) Delete(key string)              { s.data.Delete(key) }
func (s *MemoryStore) List() []*Session {
	var r []*Session
	s.data.Range(func(_, v interface{}) bool { r = append(r, v.(*Session)); return true })
	return r
}
func (s *MemoryStore) ListKeys() []string {
	var r []string
	s.data.Range(func(k, _ interface{}) bool { r = append(r, k.(string)); return true })
	return r
}
func (s *MemoryStore) Count() int {
	c := 0
	s.data.Range(func(_, _ interface{}) bool { c++; return true })
	return c
}
