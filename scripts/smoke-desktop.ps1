$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appPath = Join-Path $repoRoot 'release\win-unpacked\zemiCC.exe'
$expectedVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$zemiProcess = Start-Process -FilePath $appPath -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
try {
  $state = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($zemiProcess.HasExited) { throw 'Packaged application exited during startup' }
    try {
      $access = Invoke-RestMethod 'http://127.0.0.1:4317/api/bootstrap' -Headers @{'x-zemicc-client'='1'} -SessionVariable zemiSession
      $state = Invoke-RestMethod 'http://127.0.0.1:4317/api/state' -WebSession $zemiSession
      break
    } catch { Start-Sleep -Seconds 1 }
  }
  if ($null -eq $state -or $state.version -ne $expectedVersion) { throw 'Packaged application did not become ready' }
  if ($state.connected -or @($state.sessions).Count -ne 0) { throw 'Release started with unexpected user data' }
  $mcp = Invoke-RestMethod 'http://127.0.0.1:4317/api/mcp' -WebSession $zemiSession
  if ($null -eq $mcp.servers -or @($mcp.servers).Count -ne 0 -or $null -eq $mcp.pending -or $mcp.pending) { throw 'Release MCP manager did not start empty and idle' }
  $page = Invoke-WebRequest 'http://127.0.0.1:4317/'
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'zemiCC') { throw 'Packaged frontend unavailable' }
  $imageBytes = [System.IO.File]::ReadAllBytes((Join-Path $repoRoot 'desktop\assets\icon.png'))
  $image = Invoke-RestMethod 'http://127.0.0.1:4317/api/images' -Method Post -Headers @{'x-zemicc-token'=$access.token;'x-zemicc-filename'='package-test.png'} -ContentType 'application/octet-stream' -Body $imageBytes
  if (-not $image.id -or $image.width -le 0 -or $image.mediaType -ne 'image/png') { throw 'Packaged image decoder failed' }
  $imageView = Invoke-WebRequest "http://127.0.0.1:4317/api/images/$($image.id)" -WebSession $zemiSession
  if ($imageView.StatusCode -ne 200 -or $imageView.Headers['Content-Type'] -notmatch 'image/png') { throw 'Packaged image preview failed' }
  $agentVersion = & (Join-Path $repoRoot 'release\win-unpacked\resources\agent\claude.exe') --version
  if ($LASTEXITCODE -ne 0 -or $agentVersion -notmatch 'Claude Code') { throw 'Bundled agent did not start' }
  Write-Output "Standalone app startup verified: zemiCC $expectedVersion; bundled agent and image decoder available."
} finally {
  if (-not $zemiProcess.HasExited) {
    $null = $zemiProcess.CloseMainWindow()
    if (-not $zemiProcess.WaitForExit(10000)) { $zemiProcess.Kill() }
  }
}
