package webui

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestMaskValue(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", "(not set)"},
		{"abc", "***"},
		{"12345678", "********"},
		{"sk-ant-api03-1234567890abcdef", "sk-a****cdef"},
		{"short123", "********"},
		{"abcdefghi", "abcd****fghi"},
	}
	for _, tt := range tests {
		got := MaskValue(tt.input)
		if got != tt.want {
			t.Errorf("MaskValue(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestIsValidEnvKey(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"FEISHU_APP_ID", true},
		{"A", true},
		{"A1", true},
		{"", false},
		{"1ABC", false},
		{"lower", false},
		{"HAS SPACE", false},
		{"HAS-DASH", false},
	}
	for _, tt := range tests {
		got := isValidEnvKey(tt.key)
		if got != tt.want {
			t.Errorf("isValidEnvKey(%q) = %v, want %v", tt.key, got, tt.want)
		}
	}
}

func TestSanitizeSecrets(t *testing.T) {
	input := map[string]interface{}{
		"app_id":     "some-id",
		"app_secret": "my-super-secret",
		"bot_token":  "xoxb-12345",
		"nested": map[string]interface{}{
			"api_key": "sk-1234",
			"name":    "test",
		},
		"password":  "hunter2",
		"safe_field": "not-a-secret",
	}

	result := sanitizeSecrets(input).(map[string]interface{})

	// Secret fields should be replaced with ${VAR} placeholders
	if result["app_secret"] != "${APP_SECRET}" {
		t.Errorf("app_secret = %v, want ${APP_SECRET}", result["app_secret"])
	}
	if result["bot_token"] != "${BOT_TOKEN}" {
		t.Errorf("bot_token = %v, want ${BOT_TOKEN}", result["bot_token"])
	}
	if result["password"] != "${PASSWORD}" {
		t.Errorf("password = %v, want ${PASSWORD}", result["password"])
	}

	nested := result["nested"].(map[string]interface{})
	if nested["api_key"] != "${API_KEY}" {
		t.Errorf("nested.api_key = %v, want ${API_KEY}", nested["api_key"])
	}

	// Non-secret fields should be preserved
	if result["app_id"] != "some-id" {
		t.Errorf("app_id = %v, want some-id", result["app_id"])
	}
	if result["safe_field"] != "not-a-secret" {
		t.Errorf("safe_field = %v, want not-a-secret", result["safe_field"])
	}
	if nested["name"] != "test" {
		t.Errorf("nested.name = %v, want test", nested["name"])
	}
}

func TestSanitizeSecretsPreservesPlaceholders(t *testing.T) {
	input := map[string]interface{}{
		"app_secret": "${FEISHU_APP_SECRET}",
	}
	result := sanitizeSecrets(input).(map[string]interface{})
	if result["app_secret"] != "${FEISHU_APP_SECRET}" {
		t.Errorf("should preserve existing placeholder, got %v", result["app_secret"])
	}
}

func TestGetSecretKeys(t *testing.T) {
	// Create a temp config with an encrypted secret
	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/config.json"

	// Encrypt a test value
	enc, err := Encrypt("test-id-12345678")
	if err != nil {
		t.Fatal(err)
	}
	cfgData := fmt.Sprintf(`{"channels":{"feishu":{"app_id":%q,"app_secret":"","enabled":true}}}`, enc)
	os.WriteFile(cfgPath, []byte(cfgData), 0644)

	store := NewSecretStore(cfgPath)
	entries := store.List()
	if len(entries) == 0 {
		t.Fatal("expected entries")
	}

	var found bool
	for _, e := range entries {
		if e.Key == "FEISHU_APP_ID" {
			found = true
			if !e.IsSet {
				t.Error("FEISHU_APP_ID should be set")
			}
			if strings.Contains(e.Masked, "test-id-12345678") {
				t.Error("masked value should not contain full secret")
			}
		}
	}
	if !found {
		t.Error("FEISHU_APP_ID not found in entries")
	}
}

// --- HTTP Handler Tests ---

func setupTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	tmpFile, err := os.CreateTemp(t.TempDir(), "config-*.json")
	if err != nil {
		t.Fatal(err)
	}
	testConfig := `{"gateway":{"host":"127.0.0.1","port":18789}}`
	tmpFile.WriteString(testConfig)
	tmpFile.Close()

	s := NewServer(tmpFile.Name(), 0)
	return s, tmpFile.Name()
}

func TestHandleGetConfig(t *testing.T) {
	s, _ := setupTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	w := httptest.NewRecorder()

	s.handleConfig(w, req)

	if w.Code != 200 {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "gateway") {
		t.Error("response should contain gateway config")
	}
}

func TestHandlePostConfig(t *testing.T) {
	s, cfgPath := setupTestServer(t)

	body := `{"gateway":{"host":"127.0.0.1","port":19999}}`
	req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.postConfig(w, req)

	if w.Code != 200 {
		t.Errorf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	// Verify file was written
	data, _ := os.ReadFile(cfgPath)
	if !strings.Contains(string(data), "19999") {
		t.Error("config file should contain updated port")
	}
}

func TestHandlePostConfigInvalidJSON(t *testing.T) {
	s, _ := setupTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader("not json"))
	w := httptest.NewRecorder()

	s.postConfig(w, req)

	if w.Code != 400 {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestHandleGetSecrets(t *testing.T) {
	s, _ := setupTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/secrets", nil)
	w := httptest.NewRecorder()

	s.handleSecrets(w, req)

	if w.Code != 200 {
		t.Errorf("status = %d, want 200", w.Code)
	}

	var entries []SecretEntry
	json.NewDecoder(w.Body).Decode(&entries)
	if len(entries) == 0 {
		t.Error("should return secret entries")
	}
}

func TestHandleStatus(t *testing.T) {
	s, _ := setupTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	w := httptest.NewRecorder()

	s.handleStatus(w, req)

	if w.Code != 200 {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "running") {
		t.Error("should contain running status")
	}
}

func TestCSRFValidation(t *testing.T) {
	s, _ := setupTestServer(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/config", s.handleConfig)
	handler := s.csrfMiddleware(mux)

	// POST without CSRF token should fail
	req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("POST without CSRF: status = %d, want 403", w.Code)
	}

	// POST with matching CSRF token should succeed
	req2 := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader(`{"test":true}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-CSRF-Token", "test-token-123")
	req2.AddCookie(&http.Cookie{Name: "csrf_token", Value: "test-token-123"})
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code == http.StatusForbidden {
		t.Error("POST with valid CSRF should not be 403")
	}
}

func TestLocalhostOnly(t *testing.T) {
	s, _ := setupTestServer(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	handler := s.localhostOnly(inner)

	// Request from 127.0.0.1 should pass
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Errorf("localhost request: status = %d, want 200", w.Code)
	}

	// Request from other IP should be rejected
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "192.168.1.1:12345"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Errorf("non-localhost request: status = %d, want 403", w2.Code)
	}
}

func TestPostConfigSanitizesSecrets(t *testing.T) {
	s, cfgPath := setupTestServer(t)

	body := `{"channels":{"feishu":{"app_secret":"real-secret-value-here","app_id":"some-id"}}}`
	req := httptest.NewRequest(http.MethodPost, "/api/config", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.postConfig(w, req)

	if w.Code != 200 {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	data, _ := os.ReadFile(cfgPath)
	content := string(data)
	if strings.Contains(content, "real-secret-value-here") {
		t.Error("config should NOT contain raw secret value")
	}
	if !strings.Contains(content, "${APP_SECRET}") {
		t.Error("config should contain ${APP_SECRET} placeholder")
	}
	if !strings.Contains(content, "some-id") {
		t.Error("config should preserve non-secret app_id")
	}
}
