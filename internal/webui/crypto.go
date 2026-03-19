package webui

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

const encPrefix = "ENC:"

var (
	derivedKey  []byte
	deriveOnce  sync.Once
	deriveError error
)

// IsEncrypted returns true if the value has the ENC: prefix.
func IsEncrypted(val string) bool {
	return strings.HasPrefix(val, encPrefix)
}

// Encrypt encrypts a plaintext value using AES-256-GCM with a machine-derived key.
// Returns "ENC:<base64>" string.
func Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	key, err := getDerivedKey()
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	encoded := base64.StdEncoding.EncodeToString(ciphertext)
	return encPrefix + encoded, nil
}

// Decrypt decrypts an "ENC:<base64>" value back to plaintext.
func Decrypt(encrypted string) (string, error) {
	if encrypted == "" || !IsEncrypted(encrypted) {
		return encrypted, nil
	}
	raw := strings.TrimPrefix(encrypted, encPrefix)
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}

	key, err := getDerivedKey()
	if err != nil {
		return "", fmt.Errorf("derive key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plaintext), nil
}

// getDerivedKey returns a 32-byte AES key derived from machine identity.
func getDerivedKey() ([]byte, error) {
	deriveOnce.Do(func() {
		seed, err := machineID()
		if err != nil {
			deriveError = err
			return
		}
		// Mix with a fixed application salt
		h := sha256.New()
		h.Write([]byte("feishu-ai-assistant:secret-encryption:"))
		h.Write([]byte(seed))
		derivedKey = h.Sum(nil) // 32 bytes = AES-256
	})
	return derivedKey, deriveError
}

// machineID returns a stable machine identifier.
func machineID() (string, error) {
	switch runtime.GOOS {
	case "windows":
		return windowsMachineID()
	case "linux":
		return linuxMachineID()
	case "darwin":
		return darwinMachineID()
	default:
		return fallbackMachineID()
	}
}

func windowsMachineID() (string, error) {
	// Use Windows MachineGuid from registry
	out, err := exec.Command("reg", "query",
		`HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").CombinedOutput()
	if err != nil {
		return fallbackMachineID()
	}
	// Parse output: look for line containing MachineGuid
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "MachineGuid") {
			parts := strings.Fields(line)
			if len(parts) >= 3 {
				return parts[len(parts)-1], nil
			}
		}
	}
	return fallbackMachineID()
}

func linuxMachineID() (string, error) {
	data, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		data, err = os.ReadFile("/var/lib/dbus/machine-id")
	}
	if err != nil {
		return fallbackMachineID()
	}
	return strings.TrimSpace(string(data)), nil
}

func darwinMachineID() (string, error) {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").CombinedOutput()
	if err != nil {
		return fallbackMachineID()
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "IOPlatformUUID") {
			parts := strings.Split(line, `"`)
			if len(parts) >= 4 {
				return parts[3], nil
			}
		}
	}
	return fallbackMachineID()
}

func fallbackMachineID() (string, error) {
	hostname, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	if hostname == "" && home == "" {
		return "", fmt.Errorf("cannot determine machine identity")
	}
	return hostname + ":" + home, nil
}
