FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w" -o /feishu-ai-assistant ./cmd/server/

FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code 2>/dev/null || true
COPY --from=builder /feishu-ai-assistant /usr/local/bin/
COPY config.json /etc/feishu-ai-assistant/config.json
WORKDIR /app
RUN mkdir -p workspace/agents
EXPOSE 18789 18790
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:18790/health || exit 1
ENTRYPOINT ["feishu-ai-assistant"]
CMD ["--config", "/etc/feishu-ai-assistant/config.json"]
