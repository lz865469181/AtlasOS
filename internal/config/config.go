package config

import (
	"encoding/json"
	"fmt"
	"os"
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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	expanded := os.ExpandEnv(string(data))

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
