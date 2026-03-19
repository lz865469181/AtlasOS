package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type Config struct {
	Gateway  GatewayConfig            `json:"gateway"`
	Channels map[string]ChannelConfig `json:"channels"`
	Agent    AgentConfig              `json:"agent"`
	Memory   MemoryConfig             `json:"memory"`
	Logging  LoggingConfig            `json:"logging"`
	Health   HealthConfig             `json:"health"`
	WebUI    WebUIConfig              `json:"webui"`
}

type WebUIConfig struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

type GatewayConfig struct {
	Host                     string  `json:"host"`
	Port                     int     `json:"port"`
	MaxSessions              int     `json:"max_sessions"`
	SessionTTL               string  `json:"session_ttl"`
	ContextCompressThreshold float64 `json:"context_compress_threshold"`
}

func (g GatewayConfig) SessionTTLDuration() time.Duration {
	d, _ := time.ParseDuration(g.SessionTTL)
	if d == 0 {
		return 30 * time.Minute
	}
	return d
}

func (g GatewayConfig) Address() string {
	return fmt.Sprintf("%s:%d", g.Host, g.Port)
}

type ChannelConfig struct {
	Enabled    bool   `json:"enabled"`
	AppID      string `json:"app_id,omitempty"`
	AppSecret  string `json:"app_secret,omitempty"`
	WSEndpoint string `json:"ws_endpoint,omitempty"`
	BotToken   string `json:"bot_token,omitempty"`
	AppKey     string `json:"app_key,omitempty"`
}

type AgentConfig struct {
	ClaudeCLIPath         string     `json:"claude_cli_path"`
	ClaudeCLIArgs         []string   `json:"claude_cli_args"`
	Timeout               string     `json:"timeout"`
	MaxRetries            int        `json:"max_retries"`
	MaxConcurrentPerAgent int        `json:"max_concurrent_per_agent"`
	WorkspaceRoot         string     `json:"workspace_root"`
	Bash                  BashConfig `json:"bash"`
}

func (a AgentConfig) TimeoutDuration() time.Duration {
	d, _ := time.ParseDuration(a.Timeout)
	if d == 0 {
		return 120 * time.Second
	}
	return d
}

type BashConfig struct {
	Timeout         string   `json:"timeout"`
	MaxOutput       string   `json:"max_output"`
	Network         bool     `json:"network"`
	BlockedCommands []string `json:"blocked_commands"`
	BlockedPatterns []string `json:"blocked_patterns"`
	AllowedCommands []string `json:"allowed_commands"`
}

func (b BashConfig) TimeoutDuration() time.Duration {
	d, _ := time.ParseDuration(b.Timeout)
	if d == 0 {
		return 30 * time.Second
	}
	return d
}

func (b BashConfig) MaxOutputBytes() int64 {
	s := strings.ToUpper(b.MaxOutput)
	if strings.HasSuffix(s, "MB") {
		return 1024 * 1024
	}
	return 1024 * 1024
}

type MemoryConfig struct {
	Compaction CompactionConfig `json:"compaction"`
}

type CompactionConfig struct {
	Enabled              bool   `json:"enabled"`
	Schedule             string `json:"schedule"`
	ExpireOverriddenDays int    `json:"expire_overridden_days"`
	SummarizeThreshold   int    `json:"summarize_threshold"`
	MaxFileSize          string `json:"max_file_size"`
}

type LoggingConfig struct {
	Level  string `json:"level"`
	Format string `json:"format"`
	Output string `json:"output"`
}

type HealthConfig struct {
	Enabled  bool   `json:"enabled"`
	Endpoint string `json:"endpoint"`
	Port     int    `json:"port"`
}

func Load(path string) (*Config, error) {
	// First pass: decrypt any ENC: values in the raw JSON
	decrypted, err := decryptConfigValues(path)
	if err != nil {
		return nil, fmt.Errorf("decrypt config: %w", err)
	}
	// Second pass: expand ${ENV_VAR} placeholders
	expanded := os.ExpandEnv(string(decrypted))

	var cfg Config
	if err := json.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	applyEnvOverrides(&cfg)
	applyDefaults(&cfg)
	return &cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("FEISHU_APP_ID"); v != "" {
		if ch, ok := cfg.Channels["feishu"]; ok {
			ch.AppID = v
			cfg.Channels["feishu"] = ch
		}
	}
	if v := os.Getenv("FEISHU_APP_SECRET"); v != "" {
		if ch, ok := cfg.Channels["feishu"]; ok {
			ch.AppSecret = v
			cfg.Channels["feishu"] = ch
		}
	}
	if v := os.Getenv("CLAUDE_CLI_PATH"); v != "" {
		cfg.Agent.ClaudeCLIPath = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.Logging.Level = v
	}
}

func applyDefaults(cfg *Config) {
	if cfg.Gateway.Host == "" { cfg.Gateway.Host = "127.0.0.1" }
	if cfg.Gateway.Port == 0 { cfg.Gateway.Port = 18789 }
	if cfg.Gateway.MaxSessions == 0 { cfg.Gateway.MaxSessions = 200 }
	if cfg.Gateway.SessionTTL == "" { cfg.Gateway.SessionTTL = "30m" }
	if cfg.Gateway.ContextCompressThreshold == 0 { cfg.Gateway.ContextCompressThreshold = 0.8 }
	if cfg.Agent.ClaudeCLIPath == "" { cfg.Agent.ClaudeCLIPath = "claude" }
	if cfg.Agent.Timeout == "" { cfg.Agent.Timeout = "120s" }
	if cfg.Agent.MaxRetries == 0 { cfg.Agent.MaxRetries = 3 }
	if cfg.Agent.MaxConcurrentPerAgent == 0 { cfg.Agent.MaxConcurrentPerAgent = 5 }
	if cfg.Agent.WorkspaceRoot == "" { cfg.Agent.WorkspaceRoot = "./workspace" }
	if cfg.Agent.Bash.Timeout == "" { cfg.Agent.Bash.Timeout = "30s" }
	if cfg.Agent.Bash.MaxOutput == "" { cfg.Agent.Bash.MaxOutput = "1MB" }
	if cfg.Health.Endpoint == "" { cfg.Health.Endpoint = "/health" }
	if cfg.Health.Port == 0 { cfg.Health.Port = 18790 }
	if cfg.Logging.Level == "" { cfg.Logging.Level = "info" }
	if cfg.Logging.Format == "" { cfg.Logging.Format = "json" }
	if cfg.Logging.Output == "" { cfg.Logging.Output = "stdout" }
	if cfg.WebUI.Port == 0 { cfg.WebUI.Port = 18791 }
}

// --- Config-level decryption (no dependency on webui package) ---

const encPrefix = "ENC:"

func decryptConfigValues(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	// Quick check: if no ENC: values, skip decryption entirely
	if !strings.Contains(string(data), encPrefix) {
		return data, nil
	}
	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	key, err := configDeriveKey()
	if err != nil {
		return nil, fmt.Errorf("derive key: %w", err)
	}
	configDecryptWalk(raw, key)
	return json.Marshal(raw)
}

func configDecryptWalk(v interface{}, key []byte) {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			if s, ok := child.(string); ok && strings.HasPrefix(s, encPrefix) {
				if dec, err := configDecryptValue(s, key); err == nil {
					val[k] = dec
				}
			} else {
				configDecryptWalk(child, key)
			}
		}
	case []interface{}:
		for i, child := range val {
			if s, ok := child.(string); ok && strings.HasPrefix(s, encPrefix) {
				if dec, err := configDecryptValue(s, key); err == nil {
					val[i] = dec
				}
			} else {
				configDecryptWalk(child, key)
			}
		}
	}
}

func configDecryptValue(encrypted string, key []byte) (string, error) {
	raw := strings.TrimPrefix(encrypted, encPrefix)
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	plaintext, err := gcm.Open(nil, data[:nonceSize], data[nonceSize:], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func configDeriveKey() ([]byte, error) {
	seed, err := configMachineID()
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	h.Write([]byte("feishu-ai-assistant:secret-encryption:"))
	h.Write([]byte(seed))
	return h.Sum(nil), nil
}

func configMachineID() (string, error) {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("reg", "query",
			`HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").CombinedOutput()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				line = strings.TrimSpace(line)
				if strings.Contains(line, "MachineGuid") {
					parts := strings.Fields(line)
					if len(parts) >= 3 {
						return parts[len(parts)-1], nil
					}
				}
			}
		}
	case "linux":
		if data, err := os.ReadFile("/etc/machine-id"); err == nil {
			return strings.TrimSpace(string(data)), nil
		}
		if data, err := os.ReadFile("/var/lib/dbus/machine-id"); err == nil {
			return strings.TrimSpace(string(data)), nil
		}
	case "darwin":
		out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").CombinedOutput()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.Contains(line, "IOPlatformUUID") {
					parts := strings.Split(line, `"`)
					if len(parts) >= 4 {
						return parts[3], nil
					}
				}
			}
		}
	}
	// Fallback
	hostname, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	if hostname == "" && home == "" {
		return "", fmt.Errorf("cannot determine machine identity")
	}
	return hostname + ":" + home, nil
}
