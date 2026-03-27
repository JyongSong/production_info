param(
    [ValidateSet("install", "run")]
    [string]$Mode = "run"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-AvailablePort {
    $candidatePorts = @(5055, 5056, 5057, 5060, 5000)

    foreach ($port in $candidatePorts) {
        $listener = $null

        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
            $listener.Start()
            return $port
        }
        catch {
            continue
        }
        finally {
            if ($listener) {
                $listener.Stop()
            }
        }
    }

    throw "No available local port was found."
}

function Get-PythonRunner {
    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCommand) {
        return @{
            Command = "py"
            Prefix = @("-3")
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return @{
            Command = "python"
            Prefix = @()
        }
    }

    $fallbackPaths = @(
        "$env:LocalAppData\Python\pythoncore-3.14-64\python.exe",
        "$env:LocalAppData\Programs\Python\Python314\python.exe"
    )

    foreach ($path in $fallbackPaths) {
        if (Test-Path $path) {
            return @{
                Command = $path
                Prefix = @()
            }
        }
    }

    throw "Python was not found. Install Python and run again."
}

function Invoke-Python {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Runner,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Runner.Command @($Runner.Prefix + $Arguments)
    return $LASTEXITCODE
}

try {
    $runner = Get-PythonRunner
    $port = Get-AvailablePort
    $url = "http://127.0.0.1:$port/"

    Write-Host "Python command:" $runner.Command
    Write-Host "QR tool URL:" $url

    if ($env:QR_TOOL_TEST_ONLY -eq "1") {
        Write-Host "Launcher test passed."
        exit 0
    }

    if ($Mode -eq "install") {
        Write-Host "Installing required packages..."
        $installExitCode = Invoke-Python -Runner $runner -Arguments @("-m", "pip", "install", "-r", "requirements.txt")
        if ($installExitCode -ne 0) {
            throw "Package installation failed."
        }

        Write-Host "Package installation completed."
        exit 0
    }

    Write-Host "If this is the first run, execute install_requirements.bat first."
    Write-Host "Starting QR matching tool..."
    $env:QR_TOOL_HOST = "127.0.0.1"
    $env:QR_TOOL_PORT = "$port"
    Start-Job -ScriptBlock {
        param($TargetUrl)
        Start-Sleep -Seconds 2
        Start-Process $TargetUrl
    } -ArgumentList $url | Out-Null
    $runExitCode = Invoke-Python -Runner $runner -Arguments @("app.py")
    if ($runExitCode -ne 0) {
        throw "Application execution failed."
    }
}
catch {
    Write-Host $_.Exception.Message
    exit 1
}
