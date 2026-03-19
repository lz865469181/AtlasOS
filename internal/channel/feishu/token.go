package feishu

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type TokenManager struct {
	appID, appSecret string
	token            string
	expiresAt        time.Time
	mu               sync.RWMutex
}

func NewTokenManager(id, secret string) *TokenManager {
	return &TokenManager{appID: id, appSecret: secret}
}

func (tm *TokenManager) GetToken() (string, error) {
	tm.mu.RLock()
	if tm.token != "" && time.Now().Before(tm.expiresAt) {
		t := tm.token
		tm.mu.RUnlock()
		return t, nil
	}
	tm.mu.RUnlock()
	return tm.refresh()
}

func (tm *TokenManager) refresh() (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tm.token != "" && time.Now().Before(tm.expiresAt) {
		return tm.token, nil
	}
	body, _ := json.Marshal(map[string]string{"app_id": tm.appID, "app_secret": tm.appSecret})
	resp, err := http.Post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var r struct {
		Code   int    `json:"code"`
		Msg    string `json:"msg"`
		Token  string `json:"tenant_access_token"`
		Expire int    `json:"expire"`
	}
	json.Unmarshal(data, &r)
	if r.Code != 0 {
		return "", fmt.Errorf("token error: %d %s", r.Code, r.Msg)
	}
	tm.token = r.Token
	tm.expiresAt = time.Now().Add(time.Duration(r.Expire-300) * time.Second)
	return tm.token, nil
}
