[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$corePy = Join-Path $scriptDir "core.py"
$applioJs = Join-Path $scriptDir "bin\applio.js"

if (Test-Path (Join-Path $scriptDir ".venv\Scripts\python.exe")) {
    & (Join-Path $scriptDir ".venv\Scripts\python.exe") $corePy @Arguments
    exit $LASTEXITCODE
}
if (Test-Path (Join-Path $scriptDir "venv\Scripts\python.exe")) {
    & (Join-Path $scriptDir "venv\Scripts\python.exe") $corePy @Arguments
    exit $LASTEXITCODE
}
if (Test-Path (Join-Path $scriptDir "env\Scripts\python.exe")) {
    & (Join-Path $scriptDir "env\Scripts\python.exe") $corePy @Arguments
    exit $LASTEXITCODE
}
if ($env:PYTHON_BIN -and (Test-Path $env:PYTHON_BIN)) {
    & $env:PYTHON_BIN $corePy @Arguments
    exit $LASTEXITCODE
}

if (Get-Command "node" -ErrorAction SilentlyContinue) {
    & node $applioJs @Arguments
    exit $LASTEXITCODE
}

if (Get-Command "py" -ErrorAction SilentlyContinue) {
    & py -3.12 $corePy @Arguments
    exit $LASTEXITCODE
}

if (Get-Command "python" -ErrorAction SilentlyContinue) {
    & python $corePy @Arguments
    exit $LASTEXITCODE
}

Write-Error "Neither Node.js nor Python was found to run Applio CLI."
exit 1
