package heartbeat

import (
	"log"
	"time"
)

type Scheduler struct {
	stopChan chan struct{}
}

func NewScheduler() *Scheduler {
	return &Scheduler{stopChan: make(chan struct{})}
}

func (s *Scheduler) Register(name string, interval time.Duration, action func()) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				log.Printf("[heartbeat] %s", name)
				action()
			case <-s.stopChan:
				return
			}
		}
	}()
	log.Printf("[heartbeat] registered: %s (every %s)", name, interval)
}

func (s *Scheduler) Stop() {
	close(s.stopChan)
}
