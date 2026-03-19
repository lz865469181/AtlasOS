package webui

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// SecretKeyMapping maps a secret key name to its JSON path in config.json.
var SecretKeyMapping = map[string]string{
	"FEISHU_APP_ID":      "channels.feishu.app_id",
	"FEISHU_APP_SECRET":  "channels.feishu.app_secret",
	"TELEGRAM_BOT_TOKEN": "channels.telegram.bot_token",
	"DISCORD_BOT_TOKEN":  "channels.discord.bot_token",
	"DINGTALK_APP_KEY":   "channels.dingtalk.app_key",
	"DINGTALK_APP_SECRET":"channels.dingtalk.app_secret",
	"CLAUDE_CLI_PATH":    "agent.claude_cli_path",
	"CLAUDE_API_KEY":     "agent.claude_api_key",
	"ANTHROPIC_API_KEY":  "agent.anthropic_api_key",
}

// SecretKeyOrder defines the display order.
var SecretKeyOrder = []string{
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

// SecretEntry represents a secret with masked value.
type SecretEntry struct {
	Key    string `json:"key"`
	Masked string `json:"masked"`
	IsSet  bool   `json:"is_set"`
}

// SecretStore manages encrypted secrets in config.json.
type SecretStore struct {
	configPath string
	mu         sync.RWMutex
}

// NewSecretStore creates a store that reads/writes secrets in the config file.
func NewSecretStore(configPath string) *SecretStore {
	return &SecretStore{configPath: configPath}
}

// List returns all known secret keys with masked values.
func (ss *SecretStore) List() []SecretEntry {
	ss.mu.RLock()
	defer ss.mu.RUnlock()

	cfg := ss.readConfigMap()
	var entries []SecretEntry
	for _, key := range SecretKeyOrder {
		jsonPath, ok := SecretKeyMapping[key]
		if !ok {
			continue
		}
		rawVal := getNestedString(cfg, jsonPath)
		plaintext := ""
		if rawVal != "" {
			if IsEncrypted(rawVal) {
				decrypted, err := Decrypt(rawVal)
				if err == nil {
					plaintext = decrypted
				} else {
					plaintext = "(decrypt error)"
				}
			} else {
				// Plaintext value (legacy or non-secret)
				plaintext = rawVal
			}
		}
		entries = append(entries, SecretEntry{
			Key:    key,
			Masked: MaskValue(plaintext),
			IsSet:  plaintext != "" && plaintext != "(decrypt error)",
		})
	}
	return entries
}

// Set encrypts and writes a secret value to config.json.
func (ss *SecretStore) Set(key, value string) error {
	if key == "" || value == "" {
		return fmt.Errorf("key and value are required")
	}
	if !isValidEnvKey(key) {
		return fmt.Errorf("invalid key: %s", key)
	}
	jsonPath, ok := SecretKeyMapping[key]
	if !ok {
		return fmt.Errorf("unknown secret key: %s", key)
	}

	encrypted, err := Encrypt(value)
	if err != nil {
		return fmt.Errorf("encrypt: %w", err)
	}

	ss.mu.Lock()
	defer ss.mu.Unlock()

	cfg := ss.readConfigMap()
	setNestedStringInMap(cfg, jsonPath, encrypted)
	return ss.writeConfigMap(cfg)
}

// Remove clears a secret value in config.json (sets to empty string).
func (ss *SecretStore) Remove(key string) error {
	if key == "" {
		return fmt.Errorf("key is required")
	}
	jsonPath, ok := SecretKeyMapping[key]
	if !ok {
		return fmt.Errorf("unknown secret key: %s", key)
	}

	ss.mu.Lock()
	defer ss.mu.Unlock()

	cfg := ss.readConfigMap()
	setNestedStringInMap(cfg, jsonPath, "")
	return ss.writeConfigMap(cfg)
}

// DecryptConfig reads config.json and returns a copy with all ENC: values decrypted.
// This is used at load time so the rest of the app gets plaintext config.
func DecryptConfigFile(configPath string) ([]byte, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}
	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	decryptWalk(raw)
	return json.Marshal(raw)
}

// decryptWalk recursively decrypts all ENC: string values in a JSON tree.
func decryptWalk(v interface{}) {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			if s, ok := child.(string); ok && IsEncrypted(s) {
				if decrypted, err := Decrypt(s); err == nil {
					val[k] = decrypted
				}
			} else {
				decryptWalk(child)
			}
		}
	case []interface{}:
		for i, child := range val {
			if s, ok := child.(string); ok && IsEncrypted(s) {
				if decrypted, err := Decrypt(s); err == nil {
					val[i] = decrypted
				}
			} else {
				decryptWalk(child)
			}
		}
	}
}

// --- Helpers ---

func (ss *SecretStore) readConfigMap() map[string]interface{} {
	data, err := os.ReadFile(ss.configPath)
	if err != nil {
		return make(map[string]interface{})
	}
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		return make(map[string]interface{})
	}
	return m
}

func (ss *SecretStore) writeConfigMap(m map[string]interface{}) error {
	pretty, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ss.configPath, append(pretty, '\n'), 0644)
}

func getNestedString(m map[string]interface{}, path string) string {
	parts := strings.Split(path, ".")
	var cur interface{} = m
	for _, p := range parts {
		obj, ok := cur.(map[string]interface{})
		if !ok {
			return ""
		}
		cur = obj[p]
	}
	s, _ := cur.(string)
	return s
}

func setNestedStringInMap(m map[string]interface{}, path, value string) {
	parts := strings.Split(path, ".")
	cur := m
	for i := 0; i < len(parts)-1; i++ {
		child, ok := cur[parts[i]].(map[string]interface{})
		if !ok {
			child = make(map[string]interface{})
			cur[parts[i]] = child
		}
		cur = child
	}
	cur[parts[len(parts)-1]] = value
}

// MaskValue masks the middle of a secret value for display.
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
