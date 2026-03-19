package webui

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// SetEnvPersistent sets an environment variable that persists across reboots.
// On Windows: uses "setx" (writes to HKCU registry).
// On Linux/macOS: appends to ~/.profile.
func SetEnvPersistent(key, value string) error {
	if key == "" {
		return fmt.Errorf("key must not be empty")
	}
	if !isValidEnvKey(key) {
		return fmt.Errorf("invalid environment variable name: %s", key)
	}

	// Set in current process immediately
	os.Setenv(key, value)

	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("setx", key, value)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("setx %s: %v (%s)", key, err, strings.TrimSpace(string(out)))
		}
		return nil
	default:
		return appendToProfile(key, value)
	}
}

// RemoveEnvPersistent removes a persistent environment variable.
func RemoveEnvPersistent(key string) error {
	if key == "" {
		return fmt.Errorf("key must not be empty")
	}

	os.Unsetenv(key)

	switch runtime.GOOS {
	case "windows":
		// setx with empty string effectively removes user env var
		cmd := exec.Command("reg", "delete", `HKCU\Environment`, "/v", key, "/f")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("reg delete %s: %v (%s)", key, err, strings.TrimSpace(string(out)))
		}
		return nil
	default:
		return removeFromProfile(key)
	}
}

// GetSecretKeys returns known secret-related environment variable names and their masked values.
func GetSecretKeys() []SecretEntry {
	knownKeys := []string{
		"FEISHU_APP_ID",
		"FEISHU_APP_SECRET",
		"TELEGRAM_BOT_TOKEN",
		"DISCORD_BOT_TOKEN",
		"DINGTALK_APP_KEY",
		"DINGTALK_APP_SECRET",
		"CLAUDE_CLI_PATH",
		"CLAUDE_API_KEY",
		"ANTHROPIC_API_KEY",
	}

	var entries []SecretEntry
	for _, k := range knownKeys {
		v := os.Getenv(k)
		entries = append(entries, SecretEntry{
			Key:    k,
			Masked: MaskValue(v),
			IsSet:  v != "",
		})
	}
	return entries
}

// SecretEntry represents a secret with masked value.
type SecretEntry struct {
	Key    string `json:"key"`
	Masked string `json:"masked"`
	IsSet  bool   `json:"is_set"`
}

// MaskValue masks the middle of a secret value for display.
// Shows first 4 and last 4 characters. Empty returns "(not set)".
func MaskValue(v string) string {
	if v == "" {
		return "(not set)"
	}
	if len(v) <= 8 {
		return strings.Repeat("*", len(v))
	}
	return v[:4] + "****" + v[len(v)-4:]
}

func isValidEnvKey(key string) bool {
	if len(key) == 0 || len(key) > 256 {
		return false
	}
	for i, c := range key {
		if c >= 'A' && c <= 'Z' {
			continue
		}
		if c >= '0' && c <= '9' && i > 0 {
			continue
		}
		if c == '_' {
			continue
		}
		return false
	}
	return true
}

func profilePath() string {
	home, _ := os.UserHomeDir()
	return home + "/.profile"
}

func appendToProfile(key, value string) error {
	path := profilePath()
	// Remove existing entry first
	removeFromProfile(key)

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	// Use single quotes to prevent shell expansion, escape existing single quotes
	escaped := strings.ReplaceAll(value, "'", "'\\''")
	line := fmt.Sprintf("\nexport %s='%s'\n", key, escaped)
	_, err = f.WriteString(line)
	return err
}

func removeFromProfile(key string) error {
	path := profilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil // file doesn't exist, nothing to remove
	}

	lines := strings.Split(string(data), "\n")
	var kept []string
	prefix := "export " + key + "="
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, prefix) {
			continue
		}
		kept = append(kept, line)
	}

	return os.WriteFile(path, []byte(strings.Join(kept, "\n")), 0644)
}
