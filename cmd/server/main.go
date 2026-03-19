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
	"syscall"
	"time"

	"github.com/user/feishu-ai-assistant/internal/channel/feishu"
	"github.com/user/feishu-ai-assistant/internal/config"
	"github.com/user/feishu-ai-assistant/internal/gateway"
	"github.com/user/feishu-ai-assistant/internal/heartbeat"
)

func main() {
	cfgPath := flag.String("config", "config.json", "config file path")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("Config: %v", err)
	}

	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting Feishu AI Assistant...")

	if err := verifyCLI(cfg.Agent.ClaudeCLIPath); err != nil {
		log.Fatalf("Claude CLI: %v", err)
	}

	gw := gateway.New(*cfg)
	if err := gw.Start(context.Background()); err != nil {
		log.Fatalf("Gateway: %v", err)
	}

	if ch, ok := cfg.Channels["feishu"]; ok && ch.Enabled {
		fc := feishu.New(ch)
		gw.RegisterChannel(fc)
		if err := fc.Connect(context.Background()); err != nil {
			log.Printf("Feishu connect warning: %v", err)
		}
	}

	hb := heartbeat.NewScheduler()
	hb.Register("session_cleanup", 5*time.Minute, func() {})

	if cfg.Health.Enabled {
		go func() {
			http.HandleFunc(cfg.Health.Endpoint, func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, `{"status":"healthy","time":"%s"}`, time.Now().Format(time.RFC3339))
			})
			http.ListenAndServe(fmt.Sprintf(":%d", cfg.Health.Port), nil)
		}()
	}

	log.Printf("Ready on ws://%s", cfg.Gateway.Address())

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("Shutting down...")
	hb.Stop()
	gw.Stop()
}

func verifyCLI(path string) error {
	out, err := exec.Command(path, "--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s --version failed: %v (%s)", path, err, out)
	}
	log.Printf("Claude CLI: %s", out)
	return nil
}
