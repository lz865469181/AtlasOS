package memory

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Compactor struct {
	expireDays  int
	maxBullets  int
	maxFileSize int64
}

func NewCompactor(expireDays, maxBullets int, maxFileSize int64) *Compactor {
	return &Compactor{expireDays: expireDays, maxBullets: maxBullets, maxFileSize: maxFileSize}
}

func (c *Compactor) NeedsCompaction(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if c.maxFileSize > 0 && info.Size() > c.maxFileSize {
		return true
	}
	data, _ := os.ReadFile(path)
	bullets := 0
	for _, l := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), "- ") {
			bullets++
		}
	}
	return bullets > c.maxBullets
}

func (c *Compactor) GeneratePrompt(content string) string {
	return fmt.Sprintf("You are a memory curator. Compact this MEMORY.md:\n1. Merge duplicates\n2. Remove overridden decisions (>%d days)\n3. Summarize long sections\n4. Keep all relevant facts\n\nOutput ONLY the cleaned content.\n\n%s", c.expireDays, content)
}

func (c *Compactor) Backup(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return os.WriteFile(path+"."+time.Now().Format("20060102")+".bak", data, 0644)
}

func (c *Compactor) Apply(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}
