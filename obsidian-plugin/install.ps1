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

$pluginDir = Join-Path $obsidianDir "plugins\video-summarizer"
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
foreach ($name in @("main.js", "manifest.json", "styles.css", "LICENSE", "NOTICE")) {
    $source = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing build artifact: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $pluginDir $name) -Force
}

Write-Output "Installed Video Summarizer plugin to: $pluginDir"
