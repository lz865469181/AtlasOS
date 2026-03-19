package skill

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAll(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "web.md"), []byte("## Metadata\n- status: stable\n\n## Purpose\nSearch web"), 0644)
	os.WriteFile(filepath.Join(dir, "code.md"), []byte("## Purpose\nReview code"), 0644)
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("not skill"), 0644)
	skills, err := NewLoader(dir).LoadAll()
	if err != nil { t.Fatal(err) }
	if len(skills) != 2 { t.Errorf("expected 2, got %d", len(skills)) }
}

func TestMatchByKeywords(t *testing.T) {
	l := NewLoader("")
	skills := []*Skill{
		{Name: "web", Keywords: []string{"web", "search"}, Meta: Metadata{Status: StatusStable, Confidence: 0.9}},
		{Name: "code", Keywords: []string{"code", "review"}, Meta: Metadata{Status: StatusExperimental, Confidence: 0.6}},
		{Name: "old", Keywords: []string{"old"}, Meta: Metadata{Status: StatusDeprecated}},
	}
	m := l.MatchByKeywords("search the web", skills)
	if len(m) != 1 || m[0].Name != "web" { t.Error("match web") }
	m = l.MatchByKeywords("old stuff", skills)
	if len(m) != 0 { t.Error("deprecated") }
}

func TestNonExistentDir(t *testing.T) {
	s, err := NewLoader("/no/such/dir").LoadAll()
	if err != nil || s != nil { t.Error("nonexistent") }
}
