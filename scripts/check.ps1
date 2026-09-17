# Repo hygiene + secret scan. Used by autosync.ps1 locally; CI runs the same
# rules in .github/workflows/ci.yml. Exits 0 = clean, 1 = problems found.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$problems = @()

# --- Rule 1: no state/cache files tracked ---
$tracked = git -C $repo ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory authoring files for validation' }
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed (exit $LASTEXITCODE)" }
$bad = $tracked | Where-Object { $_ -match '(\.db$|\.db-shm$|\.db-wal$|\.pyc$|__pycache__/|node_modules/|\.curator_backups/|\.log$|\.bak(-|$))' }
foreach ($f in $bad) { $problems += "forbidden file tracked: $f" }

# --- Rule 2: every skills/<x>/ contains at least one SKILL.md ---
Get-ChildItem (Join-Path $repo 'skills') -Directory | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
    $hits = Get-ChildItem $_.FullName -Recurse -Filter 'SKILL.md' -File -ErrorAction SilentlyContinue
    if (-not $hits) {
        $files = @(Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue)
        if ($files.Count -ne 1 -or $files[0].Name -ne 'DESCRIPTION.md') {
            $problems += "skill folder without SKILL.md: skills/$($_.Name)"
        }
    }
}

# --- Rule 3: secret scan over working tree text files ---
# Placeholders (xxx, REDACTED, example, unused-for-local, <angle-bracket>) are allowed.
$secretPatterns = @(
    'sk-[A-Za-z0-9]{20,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'xox[bap]-[A-Za-z0-9-]{10,}',
    'AKIA[0-9A-Z]{16}',
    'BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY',
    'nsec1[a-z0-9]{40,}',
    'Bearer\s+[A-Za-z0-9_\-\.]{20,}',
    # value must contain a digit (random tokens do; code identifiers usually don't)
    "(api[_-]?key|token|secret|password)['`"]?\s*[:=]\s*['`"]?(?=[A-Za-z_\-\.]*\d)[A-Za-z0-9_\-\.]{16,}"
)
# Allowed: placeholders, angle-bracket stand-ins, env-var references, and
# values that are themselves env-var NAMES (ALL_CAPS_WITH_KEY/TOKEN suffix).
$allow = 'x{4,}|REDACTED|example|placeholder|unused-for-local|your[-_]|<[^>]+>|\$\{|\$env:|%[A-Z_]+%|dummy|changeme|generate-a-strong|[A-Z0-9_]+_(KEY|TOKEN|SECRET|PASSWORD)\b'
$textExt = '\.(md|py|js|mjs|ts|json|yaml|yml|ps1|psm1|cmd|bat|vbs|html|css|txt|xml|toml|cfg|ini|sh)$'

# Scan every payload file in the working tree, including untracked files.
# Never print matched content.
$payloadFiles = Get-ChildItem -LiteralPath $repo -Recurse -File -Force |
    Where-Object {
        $_.FullName -notmatch '\\(_archive|__pycache__|node_modules|\.curator_backups|\.venv|image_cache|\.hub|\.git|\.pytest_cache)\\'
    }
foreach ($path in $payloadFiles) {
    $f = $path.FullName.Substring($repo.Length).TrimStart('\') -replace '\\','/'
    if ($f -notmatch $textExt) { continue }
    $i = 0
    foreach ($line in [System.IO.File]::ReadLines($path.FullName)) {
        $i++
        foreach ($p in $secretPatterns) {
            if ($line -match $p -and $line -notmatch $allow) {
                $problems += "possible secret: ${f}:${i}"
            }
        }
    }
}

if ($problems) {
    Write-Host "CHECK FAILED - $($problems.Count) problem(s):" -ForegroundColor Red
    $problems | Select-Object -First 50 | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "check.ps1: clean"
exit 0

