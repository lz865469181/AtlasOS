.PHONY: build build-linux build-windows test clean run

BINARY=feishu-ai-assistant

build:
	go build -o bin/$(BINARY) ./cmd/server/
build-linux:
	GOOS=linux GOARCH=amd64 go build -o bin/$(BINARY)-linux-amd64 ./cmd/server/
build-windows:
	GOOS=windows GOARCH=amd64 go build -o bin/$(BINARY).exe ./cmd/server/
build-all: build-linux build-windows
test:
	go test ./... -v -count=1
clean:
	rm -rf bin/
run: build
	./bin/$(BINARY) --config config.json
