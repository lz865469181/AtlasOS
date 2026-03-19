package skill

import (
	"math"
	"time"
)

type Status string

const (
	StatusExperimental Status = "experimental"
	StatusStable       Status = "stable"
	StatusDeprecated   Status = "deprecated"
)

type Metadata struct {
	Version      string    `json:"version"`
	Author       string    `json:"author"`
	Created      time.Time `json:"created"`
	LastModified time.Time `json:"last_modified"`
	LastTested   time.Time `json:"last_tested"`
	Confidence   float64   `json:"confidence"`
	Status       Status    `json:"status"`
	TestCount    int       `json:"test_count"`
	FailCount    int       `json:"fail_count"`
}

type Skill struct {
	Name      string   `json:"name"`
	FilePath  string   `json:"file_path"`
	Meta      Metadata `json:"metadata"`
	Purpose   string   `json:"purpose"`
	WhenToUse string   `json:"when_to_use"`
	Steps     string   `json:"steps"`
	Keywords  []string `json:"keywords"`
}

func (s *Skill) RecordTest() {
	s.Meta.TestCount++
	s.Meta.Confidence = math.Round((s.Meta.Confidence+0.1)*100) / 100
	if s.Meta.Confidence > 1.0 {
		s.Meta.Confidence = 1.0
	}
	s.Meta.LastTested = time.Now()
	s.Meta.LastModified = time.Now()
	if s.Meta.Confidence >= 0.8 && s.Meta.TestCount >= 3 && s.Meta.Status == StatusExperimental {
		s.Meta.Status = StatusStable
		s.Meta.Version = "1.0"
	}
}

func (s *Skill) RecordFail() {
	s.Meta.FailCount++
	s.Meta.Confidence = math.Round((s.Meta.Confidence-0.15)*100) / 100
	if s.Meta.Confidence < 0 {
		s.Meta.Confidence = 0
	}
	s.Meta.LastTested = time.Now()
	s.Meta.LastModified = time.Now()
	if s.Meta.Confidence < 0.4 || (s.Meta.FailCount > s.Meta.TestCount && s.Meta.TestCount > 0) {
		s.Meta.Status = StatusDeprecated
	}
}

func (s *Skill) IsLoadable() bool { return s.Meta.Status != StatusDeprecated }

func NewSkill(name, filePath, purpose, whenToUse, steps string, keywords []string) *Skill {
	now := time.Now()
	return &Skill{
		Name: name, FilePath: filePath, Purpose: purpose, WhenToUse: whenToUse, Steps: steps, Keywords: keywords,
		Meta: Metadata{Version: "0.1", Author: "agent", Created: now, LastModified: now, Confidence: 0.5, Status: StatusExperimental},
	}
}
