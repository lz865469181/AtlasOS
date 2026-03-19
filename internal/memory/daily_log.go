package memory

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type DailyLog struct{ dir string }

func NewDailyLog(dir string) *DailyLog { return &DailyLog{dir: dir} }

func (d *DailyLog) Append(entry string) error {
	os.MkdirAll(d.dir, 0755)
	f, err := os.OpenFile(d.todayPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintf(f, "- [%s] %s\n", time.Now().Format("15:04:05"), entry)
	return err
}

func (d *DailyLog) todayPath() string {
	return filepath.Join(d.dir, time.Now().Format("2006-01-02")+".md")
}
