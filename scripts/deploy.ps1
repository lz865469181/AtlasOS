#
# Hot-deploy with auto-rollback (Windows PowerShell)
#
# Usage: .\scripts\deploy.ps1 [-Config config.json]
#
# Flow: Build → Backup → Stop → Replace → Start → Health Check → Rollback if failed
#

param(
    [string]$Config = "config.json"
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Binary = "$ProjectDir\bin\feishu-ai-assistant.exe"
$BinaryNew = "$ProjectDir\bin\feishu-ai-assistant-new.exe"
$BinaryOld = "$ProjectDir\bin\feishu-ai-assistant-old.exe"
$PidFile = "$ProjectDir\.feishu-ai-assistant.pid"
$HealthUrl = "http://127.0.0.1:18790/health"
$HealthTimeout = 30
$HealthInterval = 2

function Log($msg) { Write-Host "[deploy $(Get-Date -Format 'HH:mm:ss')] $msg" }

# Step 1: Build
Log "Building new binary..."
Push-Location $ProjectDir
try {
    go build -o $BinaryNew ./cmd/server/
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
} finally { Pop-Location }
Log "Build OK"

# Step 2: Backup
if (Test-Path $Binary) {
    Copy-Item $Binary $BinaryOld -Force
    Log "Backed up current binary"
}

# Step 3: Stop current
function Stop-Current {
    if (Test-Path $PidFile) {
        $pid = [int](Get-Content $PidFile)
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Log "Stopping process $pid..."
                Stop-Process -Id $pid -Force
                Start-Sleep -Seconds 2
            }
        } catch {}
    }
}

Stop-Current

# Step 4: Replace
Move-Item $BinaryNew $Binary -Force
Log "Binary replaced"

# Step 5: Start
Log "Starting new process..."
$proc = Start-Process -FilePath $Binary -ArgumentList "--config", $Config -PassThru -NoNewWindow
$newPid = $proc.Id
Log "Started with PID $newPid"

# Step 6: Health check
Log "Health check (timeout: ${HealthTimeout}s)..."
$elapsed = 0
$healthy = $false

while ($elapsed -lt $HealthTimeout) {
    Start-Sleep -Seconds $HealthInterval
    $elapsed += $HealthInterval

    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            Log "Health check PASSED at ${elapsed}s"
            $healthy = $true
            break
        }
    } catch {}

    # Check process alive
    $p = Get-Process -Id $newPid -ErrorAction SilentlyContinue
    if (-not $p) {
        Log "ERROR: New process died"
        break
    }

    Log "Pending... (${elapsed}s/${HealthTimeout}s)"
}

# Step 7: Rollback if failed
if (-not $healthy) {
    Log "ERROR: Health check FAILED. Rolling back..."

    try { Stop-Process -Id $newPid -Force } catch {}

    if (Test-Path $BinaryOld) {
        Move-Item $BinaryOld $Binary -Force
        Log "Restored old binary"

        $oldProc = Start-Process -FilePath $Binary -ArgumentList "--config", $Config -PassThru -NoNewWindow
        Log "Rolled back: PID $($oldProc.Id)"

        Start-Sleep -Seconds 5
        try {
            $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { Log "Rollback successful" }
            else { Log "WARNING: Old binary unhealthy" }
        } catch { Log "WARNING: Old binary unhealthy" }
    } else {
        Log "ERROR: No backup to rollback to!"
    }

    exit 1
}

Log "Deploy successful! PID: $newPid"
Remove-Item $BinaryOld -ErrorAction SilentlyContinue
