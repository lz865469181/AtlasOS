package skill

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Loader struct{ skillsDir string }

func NewLoader(dir string) *Loader { return &Loader{skillsDir: dir} }

func (l *Loader) LoadAll() ([]*Skill, error) {
	entries, err := os.ReadDir(l.skillsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var skills []*Skill
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		if s, err := l.loadFile(filepath.Join(l.skillsDir, e.Name())); err == nil {
			skills = append(skills, s)
		}
	}
	return skills, nil
}

func (l *Loader) MatchByKeywords(query string, skills []*Skill) []*Skill {
	words := strings.Fields(strings.ToLower(query))
	var matched []*Skill
	for _, s := range skills {
		if !s.IsLoadable() {
			continue
		}
		for _, kw := range s.Keywords {
			hit := false
			for _, w := range words {
				if strings.Contains(w, strings.ToLower(kw)) || strings.Contains(strings.ToLower(kw), w) {
					hit = true
					break
				}
			}
			if hit {
				matched = append(matched, s)
				break
			}
		}
	}
	// Sort: stable first, then by confidence desc
	for i := 0; i < len(matched); i++ {
		for j := i + 1; j < len(matched); j++ {
			if matched[j].Meta.Status == StatusStable && matched[i].Meta.Status != StatusStable {
				matched[i], matched[j] = matched[j], matched[i]
			} else if matched[j].Meta.Confidence > matched[i].Meta.Confidence && matched[i].Meta.Status == matched[j].Meta.Status {
				matched[i], matched[j] = matched[j], matched[i]
			}
		}
	}
	return matched
}

func (l *Loader) loadFile(path string) (*Skill, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSuffix(filepath.Base(path), ".md")
	s := &Skill{Name: name, FilePath: path, Meta: Metadata{Status: StatusExperimental, Confidence: 0.5}}
	var section string
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "## ") {
			section = strings.ToLower(strings.TrimPrefix(t, "## "))
			continue
		}
		switch section {
		case "purpose":
			if s.Purpose == "" && t != "" {
				s.Purpose = t
			}
		case "metadata":
			parts := strings.SplitN(t, ":", 2)
			if len(parts) == 2 {
				k, v := strings.TrimSpace(strings.TrimPrefix(parts[0], "-")), strings.TrimSpace(parts[1])
				switch strings.ToLower(k) {
				case "version":
					s.Meta.Version = v
				case "status":
					switch v {
					case "stable":
						s.Meta.Status = StatusStable
					case "deprecated":
						s.Meta.Status = StatusDeprecated
					}
				case "confidence":
					fmt.Sscanf(v, "%f", &s.Meta.Confidence)
				}
			}
		}
	}
	s.Keywords = extractKeywords(name, s.Purpose)
	return s, nil
}

func extractKeywords(name, purpose string) []string {
	combined := strings.NewReplacer("-", " ", "_", " ").Replace(name + " " + purpose)
	stop := map[string]bool{"the": true, "and": true, "for": true, "is": true, "to": true, "of": true, "in": true, "on": true, "at": true, "by": true, "with": true, "a": true, "an": true}
	seen := map[string]bool{}
	var kw []string
	for _, w := range strings.Fields(strings.ToLower(combined)) {
		if len(w) < 3 || stop[w] || seen[w] {
			continue
		}
		seen[w] = true
		kw = append(kw, w)
	}
	return kw
}
