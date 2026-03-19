package webui

import (
	"io"
	"os"
	"strings"
)

// LogWriter tees log output to both os.Stdout and the EventBus.
type LogWriter struct {
	bus    *EventBus
	stdout io.Writer
}

// NewLogWriter creates a writer that sends to stdout and the event bus.
func NewLogWriter(bus *EventBus) *LogWriter {
	return &LogWriter{bus: bus, stdout: os.Stdout}
}

// Write implements io.Writer. Each call is one log line.
func (lw *LogWriter) Write(p []byte) (int, error) {
	n, err := lw.stdout.Write(p)
	line := strings.TrimSpace(string(p))
	if line == "" {
		return n, err
	}
	level := parseLogLevel(line)
	lw.bus.PublishLog(level, line)
	return n, err
}

// parseLogLevel extracts a level hint from common log prefixes.
func parseLogLevel(line string) string {
	lower := strings.ToLower(line)
	if strings.Contains(lower, "fatal") || strings.Contains(lower, "panic") {
		return "fatal"
	}
	if strings.Contains(lower, "error") || strings.Contains(lower, "err:") {
		return "error"
	}
	if strings.Contains(lower, "warn") {
		return "warn"
	}
	if strings.Contains(lower, "debug") {
		return "debug"
	}
	return "info"
}
