package skill

import "testing"

func TestRecordTest(t *testing.T) {
	s := NewSkill("t", "/p", "p", "w", "s", nil)
	s.RecordTest(); s.RecordTest(); s.RecordTest()
	if s.Meta.TestCount != 3 { t.Error("count") }
	if s.Meta.Status != StatusStable { t.Errorf("status: %s", s.Meta.Status) }
}

func TestRecordFail(t *testing.T) {
	s := NewSkill("t", "/p", "p", "w", "s", nil)
	s.Meta.TestCount = 1
	s.RecordFail(); s.RecordFail(); s.RecordFail()
	if s.Meta.Status != StatusDeprecated { t.Error("should deprecate") }
}

func TestIsLoadable(t *testing.T) {
	s := NewSkill("t", "/p", "p", "w", "s", nil)
	if !s.IsLoadable() { t.Error("experimental loadable") }
	s.Meta.Status = StatusDeprecated
	if s.IsLoadable() { t.Error("deprecated not loadable") }
}

func TestConfidenceBounds(t *testing.T) {
	s := NewSkill("t", "/p", "p", "w", "s", nil)
	for i := 0; i < 20; i++ { s.RecordTest() }
	if s.Meta.Confidence > 1.0 { t.Error("max 1.0") }
	s2 := NewSkill("t", "/p", "p", "w", "s", nil)
	s2.Meta.Confidence = 0.1
	s2.RecordFail()
	if s2.Meta.Confidence < 0 { t.Error("min 0") }
}
