<#
.SYNOPSIS
  Builds the ECCS server images on this PC and puts them on the server, without an image registry
  (Stage H, 19 Oct 2026). infra/RUNBOOK.md explains each step in plain words.

.DESCRIPTION
  Deploy (the default):
    1. builds eccs-api, eccs-migrate and eccs-web from the current git commit, tagged with it;
    2. saves them into one gzipped file and copies it, compose.yml and the Caddyfile to the server;
    3. on the server: loads the images, keeps the running version as ":previous", makes the new
       one ":current", applies the database migrations, then restarts the API and the console
       and waits until both report healthy.
  -Rollback swaps ":current" and ":previous" on the server and restarts the API and the console.
  It does not undo database migrations (see the runbook).

  The script holds no secret: the settings stay in /opt/eccs/.env on the server.

.EXAMPLE
  .\infra\scripts\deploy.ps1 -Server 13.200.10.20 -KeyPath $HOME\.ssh\eccs-lightsail.pem

.EXAMPLE
  .\infra\scripts\deploy.ps1 -Server 13.200.10.20 -KeyPath $HOME\.ssh\eccs-lightsail.pem -Rollback
#>
param(
  # The server's static IP address (or its name).
  [Parameter(Mandatory = $true)] [string] $Server,
  # The SSH private key downloaded from Lightsail (.pem).
  [Parameter(Mandatory = $true)] [string] $KeyPath,
  # The login on the server; "ubuntu" on Lightsail's Ubuntu.
  [string] $User = 'ubuntu',
  # The server's SSH port.
  [int] $Port = 22,
  # The API's address the console is built for. Left out, it is https://<API_HOST>/v1, with
  # API_HOST read from the server's .env.
  [string] $ApiUrl = '',
  # Bring back the version that ran before the last deploy.
  [switch] $Rollback,
  # Deploy uncommitted changes too (the tag then ends in "-dirty"). For a test server only.
  [switch] $AllowDirty
)

# Not 'Stop': Windows PowerShell would treat any line a program writes to its error output (ssh's
# "Permanently added ...", docker's progress) as a failure. Each step checks its exit code instead.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.IO.Compression
$RemoteDir = '/opt/eccs'
$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..') -ErrorAction Stop).Path

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }
function Find-Tool($name, $fallback) {
  $found = Get-Command $name -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  if ($fallback -and (Test-Path -LiteralPath $fallback)) { return $fallback }
  Fail "$name was not found. See infra/RUNBOOK.md, 'What this PC needs'."
}

$docker = Find-Tool 'docker' 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$ssh = Find-Tool 'ssh' 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = Find-Tool 'scp' 'C:\Windows\System32\OpenSSH\scp.exe'
$git = Find-Tool 'git' $null
if (-not (Test-Path -LiteralPath $KeyPath)) { Fail "The SSH key $KeyPath does not exist." }
$Target = "$User@$Server"
# accept-new: the server's fingerprint is stored the first time and checked every time after.
$SshOptions = @('-i', $KeyPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30')
$SshPort = @('-p', "$Port")
$ScpPort = @('-P', "$Port")

function Remote([string] $command) {
  & $ssh @SshOptions @SshPort $Target $command | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "This command failed on the server: $command" }
}
# A command on the server whose one line of output is wanted.
function Remote-Value([string] $command) {
  $value = & $ssh @SshOptions @SshPort $Target $command
  if ($LASTEXITCODE -ne 0) { Fail "This command failed on the server: $command" }
  return "$value".Trim()
}
function Send([string[]] $files, [string] $to) {
  & $scp @SshOptions @ScpPort @files "${Target}:$to" | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "Copying to the server failed: $($files -join ', ')" }
}
# Runs a bash script on the server and gives back its exit code. The script is written with
# Linux line endings and copied over first, because Windows PowerShell would send Windows ones.
function Remote-Script([string] $name, [string] $body, [string] $arguments) {
  $local = Join-Path $env:TEMP $name
  [IO.File]::WriteAllText($local, ($body -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))
  Send @($local) "/tmp/$name"
  Remove-Item -LiteralPath $local
  & $ssh @SshOptions @SshPort $Target "bash /tmp/$name $arguments; status=`$?; rm -f /tmp/$name; exit `$status" | Out-Host
  return $LASTEXITCODE
}

Step "Checking the server $Target"
Remote "test -f $RemoteDir/.env || { echo 'There is no $RemoteDir/.env on the server yet (infra/RUNBOOK.md, the settings file).'; exit 1; }; docker version --format 'Docker {{.Server.Version}} on the server'"

# ------------------------- Rollback -------------------------
if ($Rollback) {
  $rollbackScript = @'
set -euo pipefail
cd /opt/eccs
for image in eccs-api eccs-migrate eccs-web; do
  docker image inspect "$image:previous" >/dev/null 2>&1 || { echo "There is no previous version of $image to go back to."; exit 1; }
done
for image in eccs-api eccs-migrate eccs-web; do
  # A swap, so a second -Rollback goes forward again.
  docker tag "$image:current" "$image:swap"
  docker tag "$image:previous" "$image:current"
  docker tag "$image:swap" "$image:previous"
  docker rmi "$image:swap" >/dev/null
done
revision="$(docker image inspect eccs-api:current --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
echo "$(date -u +%FT%TZ) rollback to ${revision:-a version without a label}" >> deploy-history.log
docker compose up -d --wait --force-recreate api web
docker compose ps
'@
  Step 'Going back to the previous version'
  $code = Remote-Script 'eccs-rollback.sh' $rollbackScript ''
  if ($code -ne 0) { Fail 'The rollback did not finish. Look at the messages above, and at: docker compose logs api' }
  Write-Host ''
  Write-Host 'Done: the previous version is running again. Database migrations were not undone.' -ForegroundColor Green
  exit 0
}

# ------------------------- Deploy -------------------------
Push-Location $Repo
try {
  Step 'Which version'
  $sha = (& $git rev-parse --short=12 HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { Fail 'This folder is not a git repository.' }
  $dirty = (& $git status --porcelain)
  $tag = $sha
  if ($dirty) {
    if (-not $AllowDirty) { Fail 'There are uncommitted changes. Commit them first (or add -AllowDirty for a test server).' }
    $tag = "$sha-dirty"
  }
  Write-Host "Version $tag"

  if (-not $ApiUrl) {
    $apiHost = Remote-Value "grep -m1 '^API_HOST=' $RemoteDir/.env | cut -d= -f2- | tr -d '\r'"
    if (-not $apiHost) { Fail "API_HOST is not set in $RemoteDir/.env on the server." }
    $ApiUrl = "https://$apiHost/v1"
  }
  Write-Host "The console will call the API at $ApiUrl"

  Step 'Building the images (the first build takes about 10 minutes)'
  $label = "org.opencontainers.image.revision=$tag"
  & $docker build -f infra/docker/api.Dockerfile --label $label -t "eccs-api:$tag" .
  if ($LASTEXITCODE -ne 0) { Fail 'Building the API image failed.' }
  & $docker build -f infra/docker/api.Dockerfile --target migrate --label $label -t "eccs-migrate:$tag" .
  if ($LASTEXITCODE -ne 0) { Fail 'Building the database tools image failed.' }
  & $docker build -f infra/docker/web.Dockerfile --build-arg "NEXT_PUBLIC_API_URL=$ApiUrl" --label $label -t "eccs-web:$tag" .
  if ($LASTEXITCODE -ne 0) { Fail 'Building the console image failed.' }

  $bundle = Join-Path $env:TEMP "eccs-$tag.tar"
  $zipped = "$bundle.gz"
  $onServer = Remote-Value "docker image inspect eccs-api:$tag eccs-migrate:$tag eccs-web:$tag >/dev/null 2>&1 && echo yes || echo no"
  if ($onServer -eq 'yes') {
    Write-Host 'The server already has this version; nothing to upload.'
  } else {
    Step 'Saving the images into one gzipped file'
    & $docker save -o $bundle "eccs-api:$tag" "eccs-migrate:$tag" "eccs-web:$tag"
    if ($LASTEXITCODE -ne 0) { Fail 'Saving the images failed.' }
    $in = [IO.File]::OpenRead($bundle)
    $out = [IO.File]::Create($zipped)
    $gzip = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
    try { $in.CopyTo($gzip) } finally { $gzip.Dispose(); $out.Dispose(); $in.Dispose() }
    Remove-Item -LiteralPath $bundle
    Write-Host ('{0:N0} MB to upload' -f ((Get-Item -LiteralPath $zipped).Length / 1MB))

    Step 'Copying it to the server'
    Send @($zipped) "/tmp/eccs-$tag.tar.gz"
    Remove-Item -LiteralPath $zipped
  }

  Step 'Copying compose.yml and the Caddyfile'
  Send @('infra/server/compose.yml', 'infra/server/Caddyfile') "$RemoteDir/"
} finally {
  Pop-Location
}

$deployScript = @'
set -euo pipefail
tag="$1"
cd /opt/eccs
# A settings file edited on Windows has Windows line endings, which would end up inside the values.
sed -i 's/\r$//' .env
if [ -f "/tmp/eccs-$tag.tar.gz" ]; then
  echo "Loading the images"
  gunzip -c "/tmp/eccs-$tag.tar.gz" | docker load
  rm -f "/tmp/eccs-$tag.tar.gz"
fi
# Keep what runs now as ":previous", unless it is this same version again.
if docker image inspect eccs-api:current >/dev/null 2>&1 && [ "$(docker image inspect -f '{{.Id}}' eccs-api:current)" != "$(docker image inspect -f '{{.Id}}' "eccs-api:$tag")" ]; then
  for image in eccs-api eccs-migrate eccs-web; do docker tag "$image:current" "$image:previous"; done
fi
for image in eccs-api eccs-migrate eccs-web; do docker tag "$image:$tag" "$image:current"; done

echo "Applying database migrations"
if ! docker compose run --rm migrate; then
  echo "The migrations failed, so the new version was not started. The old one is still running."
  if docker image inspect eccs-api:previous >/dev/null 2>&1; then
    for image in eccs-api eccs-migrate eccs-web; do docker tag "$image:previous" "$image:current"; done
  fi
  exit 1
fi

echo "Starting the new version"
docker compose up -d --wait --force-recreate api web
docker compose up -d --wait
# Caddy reads its file only at start or on reload.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
echo "$(date -u +%FT%TZ) deployed $tag" >> deploy-history.log

# Keep the three newest versions' images; older ones only fill the disk.
for image in eccs-api eccs-migrate eccs-web; do
  docker image ls "$image" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r | cut -d'|' -f2 \
    | grep -vE '^(current|previous)$' | tail -n +4 | while read -r old; do docker rmi "$image:$old" >/dev/null || true; done
done
docker image prune -f >/dev/null
docker compose ps
'@

Step 'Starting it on the server'
$code = Remote-Script 'eccs-deploy.sh' $deployScript $tag
if ($code -ne 0) {
  Fail "The new version did not start properly. Its log: ssh -i $KeyPath $Target 'cd $RemoteDir && docker compose logs --tail 100 api'. To go back: .\infra\scripts\deploy.ps1 -Server $Server -KeyPath $KeyPath -Rollback"
}
Write-Host ''
Write-Host "Done: version $tag is running. Check $ApiUrl/health in a browser." -ForegroundColor Green
