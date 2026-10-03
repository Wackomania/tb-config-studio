<#
.SYNOPSIS
    Builds TBConfigStudio-Setup.exe, uninstall.exe and a portable folder with nothing but what Windows already has: Windows PowerShell 5.1,
    the .NET Framework C# compiler (csc.exe) and Node.js (copied in as runtime\node.exe so the target PC needs no Node). No third-party
    tool, no network access, no signing certificate (the exes are not signed: Windows SmartScreen may warn).
.DESCRIPTION
    1. stage: app\ (src, schemas, presets, docs), runtime\node.exe
    2. TBConfigStudio.exe (cs\TBConfigStudio.cs, per-user, asInvoker manifest) and uninstall.exe (installer\Setup.cs, /define:UNINSTALL_ONLY)
    3. manifest.json with the SHA-256 of every file, payload.zip
    4. TBConfigStudio-Setup.exe = installer\Setup.cs + installer\Wizard.cs with payload.zip as a resource
    5. portable folder (dist\portable\TBConfigStudio) with a portable.txt marker: data stays beside the exe
    Output: <OutDir>\TBConfigStudio-Setup.exe, .sha256, uninstall.exe, build.json and <OutDir>\..\portable
.PARAMETER NodeExe  The node.exe to bundle (default: the one on this PC's PATH).
.PARAMETER DryRun   Print every step as PLAN: ... and write nothing.
.EXAMPLE
    .\scripts\build-installer.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$OutDir,
    [string]$NodeExe,
    [string]$Version = '',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = [System.IO.Path]::GetFullPath((Join-Path $here '..'))
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist\installer' }
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$portableDir = Join-Path (Split-Path -Parent $OutDir) 'portable\TBConfigStudio'
function Step([string]$text) { Write-Host ($(if ($DryRun) { 'PLAN: ' } else { '' }) + $text) }

$csc = Join-Path ([System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'The .NET Framework C# compiler (csc.exe) was not found next to the .NET runtime.' }
$node = if ($NodeExe) { $NodeExe } else { $c = Get-Command node.exe -ErrorAction SilentlyContinue; if ($c) { $c.Source } else { $null } }
if (-not $node -or -not (Test-Path -LiteralPath $node)) { throw 'node.exe was not found. Pass -NodeExe <path>.' }
if (-not $Version) { $Version = (& $node -p "require('$($repo -replace '\\', '/')/package.json').version").Trim() }
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,30})?$') { throw "The version '$Version' is not like 1.2.3." }

$refs = @('/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll')
$icon = Join-Path $repo 'src\ui\favicon.ico'
$manifestXml = Join-Path $repo 'installer\app.manifest'
$appDirs = @('src', 'schemas', 'presets')
$appFiles = @('package.json', 'README.md', 'CHANGELOG.md', 'docs\USER-GUIDE.md', 'docs\SCHEMA-FORMAT.md', 'docs\SECURITY-REVIEW.md')

Step "version $Version, output folder $OutDir, portable folder $portableDir"
Step "compiler $csc"
Step ('stage app\: ' + ($appDirs -join ', ') + ', ' + ($appFiles -join ', '))
Step "runtime\node.exe from $node ($([int]((Get-Item -LiteralPath $node).Length / 1MB)) MB)"
Step 'TBConfigStudio.exe (cs\TBConfigStudio.cs, asInvoker manifest, icon src\ui\favicon.ico)'
Step 'uninstall.exe (installer\Setup.cs, /define:UNINSTALL_ONLY)'
Step 'manifest.json with the SHA-256 of every file, payload.zip'
Step 'TBConfigStudio-Setup.exe (Setup.cs + Wizard.cs, payload.zip as a resource), .sha256, build.json'
Step 'portable folder with portable.txt (no uninstaller)'
if ($DryRun) { Write-Host 'Dry run: nothing was written.'; exit 0 }

function Invoke-Csc([string[]]$CscArgs, [string]$What) {
    $out = & $csc /nologo @CscArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "$What could not be built:`r`n$out" }
}
function Get-Sha256([string]$Path) { $s = [System.Security.Cryptography.SHA256]::Create(); $f = [System.IO.File]::OpenRead($Path); try { (($s.ComputeHash($f) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $f.Dispose() } }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('tbs-installer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'app'), (Join-Path $stage 'runtime') | Out-Null
try {
    Push-Location $repo
    foreach ($d in $appDirs) { Copy-Item -LiteralPath (Join-Path $repo $d) -Destination (Join-Path $stage "app\$d") -Recurse }
    foreach ($rel in $appFiles) { $src = Join-Path $repo $rel; if (Test-Path -LiteralPath $src) { $dst = Join-Path $stage ('app\' + $rel); New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null; Copy-Item -LiteralPath $src -Destination $dst } }
    $pj = Get-Content -LiteralPath (Join-Path $stage 'app\package.json') -Raw | ConvertFrom-Json; $pj.version = $Version
    [System.IO.File]::WriteAllText((Join-Path $stage 'app\package.json'), (($pj | ConvertTo-Json -Depth 5) + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime\node.exe')
    Invoke-Csc (@('/target:winexe', "/out:$(Join-Path $stage 'TBConfigStudio.exe')", "/win32icon:$icon", "/win32manifest:$manifestXml") + $refs + @('cs\TBConfigStudio.cs')) 'TBConfigStudio.exe'
    Invoke-Csc (@('/target:winexe', "/out:$(Join-Path $stage 'uninstall.exe')", '/define:UNINSTALL_ONLY', "/win32icon:$icon", "/win32manifest:$manifestXml") + $refs + @('installer\Setup.cs')) 'uninstall.exe'
    # portable folder: same files, no uninstaller, data beside the exe
    if (Test-Path -LiteralPath $portableDir) { Remove-Item -LiteralPath $portableDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
    Copy-Item -Path (Join-Path $stage '*') -Destination $portableDir -Recurse
    Remove-Item -LiteralPath (Join-Path $portableDir 'uninstall.exe') -Force
    [System.IO.File]::WriteAllText((Join-Path $portableDir 'portable.txt'), "This file makes TB Config Studio keep its settings and backups in the data folder next to the program.`r`n", [System.Text.Encoding]::ASCII)
    # manifest and payload
    $files = [ordered]@{}
    foreach ($f in (Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName)) { $rel = $f.FullName.Substring($stage.Length + 1).Replace('\', '/'); $files[$rel] = Get-Sha256 $f.FullName }
    $manifest = [ordered]@{ name = 'tb-config-studio-setup'; version = $Version; builtAt = (Get-Date).ToUniversalTime().ToString('o'); files = $files }
    [System.IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), ((ConvertTo-Json -InputObject $manifest -Depth 4) + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = Join-Path ([System.IO.Path]::GetTempPath()) ('tbs-payload-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.zip')
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $setup = Join-Path $OutDir 'TBConfigStudio-Setup.exe'
    Invoke-Csc (@('/target:winexe', "/out:$setup", "/resource:$zip,payload.zip", "/win32icon:$icon", "/win32manifest:$manifestXml") + $refs + @('installer\Setup.cs', 'installer\Wizard.cs')) 'TBConfigStudio-Setup.exe'
    Copy-Item -LiteralPath (Join-Path $stage 'uninstall.exe') -Destination (Join-Path $OutDir 'uninstall.exe') -Force
    Remove-Item -LiteralPath $zip -Force
    $hash = Get-Sha256 $setup
    [System.IO.File]::WriteAllText("$setup.sha256", "$hash *TBConfigStudio-Setup.exe`r`n", [System.Text.Encoding]::ASCII)
    $report = [ordered]@{ version = $Version; sha256 = $hash; size = (Get-Item -LiteralPath $setup).Length; files = $files.Count; signed = $false; builtAt = $manifest.builtAt }
    [System.IO.File]::WriteAllText((Join-Path $OutDir 'build.json'), ((ConvertTo-Json -InputObject $report) + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Built $setup ($([int]((Get-Item -LiteralPath $setup).Length / 1MB)) MB, $($files.Count) files, sha256 $($hash.Substring(0, 16))...)"
    Write-Host "Portable folder: $portableDir"
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
