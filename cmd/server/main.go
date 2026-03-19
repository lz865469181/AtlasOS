package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel/feishu"
	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/gateway"
	"github.com/user/feishu-ai-assistant/internal/heartbeat"
	"github.com/user/feishu-ai-assistant/internal/memory"
)

func main() {
	cfgPath := flag.String("config", "config.json", "config file path")
	flag.Parse()

	// 1. Load config
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("Config: %v", err)
	}

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting Feishu AI Assistant...")

	// 2. Singleton lock (FR-11)
	if err := acquirePIDLock(); err != nil {
		log.Fatalf("Another instance is running: %v", err)
	}
	defer releasePIDLock()

	// 3. Verify Claude CLI
	if err := verifyCLI(cfg.Agent.ClaudeCLIPath); err != nil {
		log.Fatalf("Claude CLI: %v", err)
	}

	// 4. Start Gateway
	gw := gateway.New(*cfg)
	if err := gw.Start(context.Background()); err != nil {
		log.Fatalf("Gateway: %v", err)
	}

	// 5. Start Feishu Channel
	if ch, ok := cfg.Channels["feishu"]; ok && ch.Enabled {
		fc := feishu.New(ch)
		gw.RegisterChannel(fc)
		if err := fc.Connect(context.Background()); err != nil {
			log.Printf("Feishu connect warning: %v (will retry)", err)
		} else {
			log.Println("Feishu channel connected")
		}
	}

	// 6. Start Heartbeat with real tasks (Fix #4)
	hb := heartbeat.NewScheduler()
	setupHeartbeat(hb, cfg, gw)

	// 7. Health check HTTP
	var healthServer *http.Server
	if cfg.Health.Enabled {
		healthServer = startHealthCheck(cfg.Health)
	}

	log.Printf("Ready on ws://%s", cfg.Gateway.Address())

	// 8. Wait for signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("Shutting down...")
	hb.Stop()
	gw.Stop()
	if healthServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		healthServer.Shutdown(ctx)
	}
	log.Println("Shutdown complete")
}

func verifyCLI(path string) error {
	out, err := exec.Command(path, "--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s --version failed: %v (%s)", path, err, out)
	}
	log.Printf("Claude CLI: %s", string(out))
	return nil
}

// --- Singleton PID Lock (FR-11) ---

const pidFile = ".feishu-ai-assistant.pid"

func acquirePIDLock() error {
	if data, err := os.ReadFile(pidFile); err == nil {
		pid, _ := strconv.Atoi(string(data))
		if pid > 0 && processExists(pid) {
			return fmt.Errorf("process %d already running", pid)
		}
	}
	return os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0644)
}

func releasePIDLock() {
	os.Remove(pidFile)
}

func processExists(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix, FindProcess always succeeds; send signal 0 to check.
	// On Windows, FindProcess fails if process doesn't exist.
	err = p.Signal(syscall.Signal(0))
	return err == nil
}

// --- Heartbeat Setup (Fix #4) ---

func setupHeartbeat(hb *heartbeat.Scheduler, cfg *config.Config, gw *gateway.Gateway) {
	// Session cleanup — real implementation
	hb.Register("session_cleanup", 5*time.Minute, func() {
		n := gw.SessionManager().CleanupExpired()
		if n > 0 {
			log.Printf("[heartbeat] cleaned %d expired sessions", n)
		}
	})

	// Memory compaction
	if cfg.Memory.Compaction.Enabled {
		compactor := memory.NewCompactor(
			cfg.Memory.Compaction.ExpireOverriddenDays,
			cfg.Memory.Compaction.SummarizeThreshold,
			50*1024,
		)
		hb.Register("memory_compaction", 24*time.Hour, func() {
			// Scan all agent workspaces for MEMORY.md files needing compaction
			agentIDs := gw.Scheduler().ListAgents()
			for _, id := range agentIDs {
				inst, ok := gw.Scheduler().GetInstance(id)
				if !ok {
					continue
				}
				wsDir := inst.Workspace()
				// Walk users directory
				usersDir := filepath.Join(wsDir.AgentDir(), "users")
				entries, err := os.ReadDir(usersDir)
				if err != nil {
					continue
				}
				for _, entry := range entries {
					if !entry.IsDir() {
						continue
					}
					memPath := wsDir.UserMEMORYPath(entry.Name())
					if compactor.NeedsCompaction(memPath) {
						log.Printf("[heartbeat] compacting MEMORY.md for user %s agent %s", entry.Name(), id)
						compactor.Backup(memPath)
						// In production, would call Claude CLI to summarize
						// For now, log the need
						log.Printf("[heartbeat] compaction needed for %s (use /feedback to trigger)", memPath)
					}
				}
			}
		})
	}

	// SOUL integrity check
	hb.Register("soul_integrity", 1*time.Hour, func() {
		for _, id := range gw.Scheduler().ListAgents() {
			inst, ok := gw.Scheduler().GetInstance(id)
			if !ok {
				continue
			}
			hash, err := inst.Workspace().VerifySOULIntegrity()
			if err != nil {
				log.Printf("[heartbeat] SOUL integrity check failed for agent %s: %v", id, err)
			} else {
				log.Printf("[heartbeat] agent %s SOUL hash: %s", id, hash[:16])
			}
		}
	})
}

// --- Health Check ---

func startHealthCheck(cfg config.HealthConfig) *http.Server {
	mux := http.NewServeMux()
	startTime := time.Now()
	mux.HandleFunc(cfg.Endpoint, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		uptime := int64(time.Since(startTime).Seconds())
		fmt.Fprintf(w, `{"status":"healthy","uptime":%d,"time":"%s"}`, uptime, time.Now().Format(time.RFC3339))
	})
	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: mux}
	go func() {
		log.Printf("Health check on http://0.0.0.0:%d%s", cfg.Port, cfg.Endpoint)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Health server error: %v", err)
		}
	}()
	return srv
}
