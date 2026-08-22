[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath
)

$ErrorActionPreference = "Stop"
$vault = (Resolve-Path -LiteralPath $VaultPath).Path
$obsidianDir = Join-Path $vault ".obsidian"
if (-not (Test-Path -LiteralPath $obsidianDir -PathType Container)) {
    throw "Not an Obsidian vault (missing .obsidian): $vault"
}

$pluginDir = Join-Path $obsidianDir "plugins\video-memo"
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
foreach ($name in @("main.js", "manifest.json", "styles.css", "LICENSE", "NOTICE", "COPYRIGHT.md")) {
    $source = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing build artifact: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $pluginDir $name) -Force
}

# Pre-fill the engine location the first time so a fresh install works without
# manual configuration. Existing values are never overwritten.
$dataFile = Join-Path $pluginDir "data.json"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (Test-Path -LiteralPath (Join-Path $repoRoot "src\pipeline.py") -PathType Leaf) {
    $needsWrite = $true
    $data = $null
    if (Test-Path -LiteralPath $dataFile -PathType Leaf) {
        try {
            $data = Get-Content -LiteralPath $dataFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            $data = $null
        }
        if ($null -ne $data -and $data.PSObject.Properties["projectPath"] -and $data.projectPath) {
            $needsWrite = $false
        }
    }
    if ($needsWrite) {
        if ($null -eq $data) { $data = [PSCustomObject]@{} }
        if (-not $data.PSObject.Properties["projectPath"]) {
            $data | Add-Member -NotePropertyName "projectPath" -NotePropertyValue ""
        }
        $data.projectPath = $repoRoot
        $data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $dataFile -Encoding UTF8
        Write-Output "Pre-filled projectPath: $repoRoot"
    }
}

Write-Output "Installed VideoMemo plugin to: $pluginDir"
