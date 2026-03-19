package webui

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Server is the local web UI configuration console.
type Server struct {
	configPath string
	addr       string
	startTime  time.Time
	srv        *http.Server
	mu         sync.RWMutex
}

// NewServer creates a web UI server bound to 127.0.0.1 on the given port.
func NewServer(configPath string, port int) *Server {
	return &Server{
		configPath: configPath,
		addr:       fmt.Sprintf("127.0.0.1:%d", port),
		startTime:  time.Now(),
	}
}

// Start begins serving in a goroutine. Non-blocking.
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// Static SPA
	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		return fmt.Errorf("embed static: %w", err)
	}
	mux.Handle("/", http.FileServer(http.FS(staticSub)))

	// API routes
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/secrets", s.handleSecrets)
	mux.HandleFunc("/api/status", s.handleStatus)

	s.srv = &http.Server{
		Addr:         s.addr,
		Handler:      s.localhostOnly(s.csrfMiddleware(mux)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.addr, err)
	}

	go func() {
		log.Printf("WebUI console on http://%s", s.addr)
		if err := s.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("WebUI server error: %v", err)
		}
	}()
	return nil
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
	if s.srv != nil {
		s.srv.Close()
	}
}

// --- Middleware ---

// localhostOnly rejects requests not originating from 127.0.0.1 or ::1.
func (s *Server) localhostOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if host != "127.0.0.1" && host != "::1" {
			http.Error(w, "Forbidden: localhost only", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// csrfMiddleware sets a CSRF token cookie and validates it on mutating requests.
func (s *Server) csrfMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CSRF cookie if missing
		if _, err := r.Cookie("csrf_token"); err != nil {
			token := generateToken()
			http.SetCookie(w, &http.Cookie{
				Name:     "csrf_token",
				Value:    token,
				Path:     "/",
				HttpOnly: false, // JS needs to read it
				SameSite: http.SameSiteStrictMode,
			})
		}

		// Validate on mutating methods
		if r.Method == http.MethodPost || r.Method == http.MethodDelete || r.Method == http.MethodPut {
			cookie, err := r.Cookie("csrf_token")
			if err != nil {
				jsonError(w, "CSRF token missing", http.StatusForbidden)
				return
			}
			header := r.Header.Get("X-CSRF-Token")
			if header == "" || header != cookie.Value {
				jsonError(w, "CSRF token mismatch", http.StatusForbidden)
				return
			}
		}

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// --- API Handlers ---

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.getConfig(w, r)
	case http.MethodPost:
		s.postConfig(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) getConfig(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.configPath)
	if err != nil {
		jsonError(w, "read config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Return raw JSON (with ${VAR} placeholders intact, not expanded)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) postConfig(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		jsonError(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate it's valid JSON by re-marshaling with indent
	var parsed interface{}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		jsonError(w, "invalid JSON structure: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Sanitize: detect and replace raw secret-looking values with placeholders
	sanitized := sanitizeSecrets(parsed)

	pretty, err := json.MarshalIndent(sanitized, "", "  ")
	if err != nil {
		jsonError(w, "marshal: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(s.configPath, append(pretty, '\n'), 0644); err != nil {
		jsonError(w, "write config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"status": "saved"})
}

func (s *Server) handleSecrets(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.getSecrets(w, r)
	case http.MethodPost:
		s.postSecret(w, r)
	case http.MethodDelete:
		s.deleteSecret(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) getSecrets(w http.ResponseWriter, _ *http.Request) {
	entries := GetSecretKeys()
	jsonOK(w, entries)
}

func (s *Server) postSecret(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Key == "" || req.Value == "" {
		jsonError(w, "key and value are required", http.StatusBadRequest)
		return
	}

	if err := SetEnvPersistent(req.Key, req.Value); err != nil {
		jsonError(w, "set env: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"status": "set", "key": req.Key})
}

func (s *Server) deleteSecret(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Key == "" {
		jsonError(w, "key is required", http.StatusBadRequest)
		return
	}

	if err := RemoveEnvPersistent(req.Key); err != nil {
		jsonError(w, "remove env: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]string{"status": "removed", "key": req.Key})
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	uptime := int64(time.Since(s.startTime).Seconds())
	jsonOK(w, map[string]interface{}{
		"status":         "running",
		"uptime_seconds": uptime,
		"config_path":    s.configPath,
		"webui_addr":     s.addr,
		"platform":       fmt.Sprintf("%s", os.Getenv("OS")),
		"time":           time.Now().Format(time.RFC3339),
	})
}

// --- Helpers ---

func jsonOK(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func generateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// sanitizeSecrets walks JSON and replaces values that look like secrets
// with ${KEY} placeholders. Detects tokens, API keys, etc.
func sanitizeSecrets(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{})
		for k, child := range val {
			if isSecretField(k) {
				if s, ok := child.(string); ok && s != "" && !strings.HasPrefix(s, "${") {
					// Replace with env var placeholder
					envKey := strings.ToUpper(strings.ReplaceAll(k, "-", "_"))
					out[k] = "${" + envKey + "}"
					continue
				}
			}
			out[k] = sanitizeSecrets(child)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(val))
		for i, child := range val {
			out[i] = sanitizeSecrets(child)
		}
		return out
	default:
		return v
	}
}

func isSecretField(name string) bool {
	lower := strings.ToLower(name)
	secretPatterns := []string{"secret", "token", "password", "api_key", "apikey"}
	for _, p := range secretPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}
