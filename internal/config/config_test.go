package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "config.json")
	os.WriteFile(p, []byte(`{"gateway":{"host":"127.0.0.1","port":18789,"session_ttl":"15m"},"channels":{"feishu":{"enabled":true,"app_id":"test"}},"agent":{"claude_cli_path":"/usr/bin/claude","timeout":"60s","bash":{"timeout":"10s"}},"logging":{"level":"debug"},"health":{"port":9090}}`), 0644)
	cfg, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Gateway.Port != 18789 {
		t.Errorf("port: %d", cfg.Gateway.Port)
	}
	if cfg.Gateway.Address() != "127.0.0.1:18789" {
		t.Errorf("addr: %s", cfg.Gateway.Address())
	}
	if cfg.Channels["feishu"].AppID != "test" {
		t.Error("app_id mismatch")
	}
}

func TestDefaults(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "c.json")
	os.WriteFile(p, []byte(`{}`), 0644)
	cfg, _ := Load(p)
	if cfg.Gateway.Host != "127.0.0.1" { t.Error("default host") }
	if cfg.Gateway.Port != 18789 { t.Error("default port") }
	if cfg.Agent.ClaudeCLIPath != "claude" { t.Error("default cli") }
	if cfg.Health.Port != 18790 { t.Error("default health port") }
}

func TestEnvOverride(t *testing.T) {
	tmp := t.TempDir()
	p := filepath.Join(tmp, "c.json")
	os.WriteFile(p, []byte(`{"channels":{"feishu":{"enabled":true,"app_id":""}}}`), 0644)
	os.Setenv("FEISHU_APP_ID", "env_id")
	defer os.Unsetenv("FEISHU_APP_ID")
	cfg, _ := Load(p)
	if cfg.Channels["feishu"].AppID != "env_id" {
		t.Errorf("env override: %s", cfg.Channels["feishu"].AppID)
	}
}
