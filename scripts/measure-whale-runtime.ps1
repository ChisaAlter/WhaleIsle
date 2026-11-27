param(
  [ValidateRange(10, 3600)][int]$Seconds = 120,
  [ValidateRange(1, 30)][int]$IntervalSeconds = 2,
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$started = Get-Date
$previous = @{}
$samples = [Collections.Generic.List[object]]::new()

function Get-Role([string]$commandLine) {
  $match = [regex]::Match($commandLine, '--dshd-shell-role=([^ ]+)')
  if ($match.Success) { return $match.Groups[1].Value }
  $match = [regex]::Match($commandLine, '--type=([^ ]+)')
  if ($match.Success) { return $match.Groups[1].Value }
  if ($commandLine -match 'dshd-daemon-runner') { return 'daemon' }
  if ($commandLine -match 'terminal-worker-process') { return 'terminal-worker' }
  return 'main'
}

function Get-Quantile([double[]]$values, [double]$fraction) {
  if ($values.Count -eq 0) { return $null }
  $sorted = @($values | Sort-Object)
  return [math]::Round($sorted[[math]::Ceiling(($sorted.Count - 1) * $fraction)], 2)
}

function Read-GpuCounter([string]$counterPath, [int[]]$processIds, [double]$divisor) {
  $result = @{}
  try {
    $counter = Get-Counter $counterPath -ErrorAction Stop
    foreach ($sample in $counter.CounterSamples) {
      $match = [regex]::Match($sample.Path, 'pid_(\d+)')
      if (-not $match.Success) { continue }
      $processId = [int]$match.Groups[1].Value
      if ($processId -notin $processIds) { continue }
      if (-not $result.ContainsKey($processId)) { $result[$processId] = 0.0 }
      $result[$processId] += $sample.CookedValue / $divisor
    }
  } catch {
    return @{ available = $false; reason = $_.Exception.Message; values = @{} }
  }
  return @{ available = $true; values = $result }
}

while (((Get-Date) - $started).TotalSeconds -lt $Seconds) {
  $at = Get-Date
  $processes = @(Get-CimInstance Win32_Process -Filter "name = 'electron.exe' or name = 'WhaleIsle.exe' or name = 'Whale Isle.exe' or name = 'Deepseek-Harness-Desktop.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase) })
  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    try { $live = Get-Process -Id $processId -ErrorAction Stop } catch { continue }
    $cpuPercent = $null
    if ($previous.ContainsKey($processId)) {
      $old = $previous[$processId]
      $elapsed = ($at - $old.at).TotalSeconds
      if ($elapsed -gt 0) { $cpuPercent = [math]::Round(100 * ($live.CPU - $old.cpu) / $elapsed, 2) }
    }
    $previous[$processId] = @{ at = $at; cpu = $live.CPU }
    $samples.Add([pscustomobject]@{
      at = $at.ToString('o')
      pid = $processId
      role = Get-Role $process.CommandLine
      cpuPercentOneCore = $cpuPercent
      privateMiB = [math]::Round($live.PrivateMemorySize64 / 1MB, 2)
      workingMiB = [math]::Round($live.WorkingSet64 / 1MB, 2)
    })
  }
  $remaining = $Seconds - ((Get-Date) - $started).TotalSeconds
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([math]::Min($remaining * 1000, $IntervalSeconds * 1000)) }
}

$processIds = @($samples | Select-Object -ExpandProperty pid -Unique)
$dedicated = Read-GpuCounter '\GPU Process Memory(*)\Dedicated Usage' $processIds 1MB
$shared = Read-GpuCounter '\GPU Process Memory(*)\Shared Usage' $processIds 1MB
$engine = Read-GpuCounter '\GPU Engine(*)\Utilization Percentage' $processIds 1
$summary = @($samples | Group-Object role, pid | ForEach-Object {
  $group = $_.Group
  $processId = [int]$group[0].pid
  $cpuValues = [double[]]@($group | Where-Object { $null -ne $_.cpuPercentOneCore } | ForEach-Object { $_.cpuPercentOneCore })
  $privateValues = [double[]]@($group | ForEach-Object { $_.privateMiB })
  [pscustomobject]@{
    role = $group[0].role
    pid = $processId
    cpuP50OneCore = Get-Quantile $cpuValues 0.5
    cpuP95OneCore = Get-Quantile $cpuValues 0.95
    privateP50MiB = Get-Quantile $privateValues 0.5
    privateP95MiB = Get-Quantile $privateValues 0.95
    workingLastMiB = $group[-1].workingMiB
    gpuDedicatedMiB = if ($dedicated.available -and $dedicated.values.ContainsKey($processId)) { [math]::Round($dedicated.values[$processId], 2) } else { $null }
    gpuSharedMiB = if ($shared.available -and $shared.values.ContainsKey($processId)) { [math]::Round($shared.values[$processId], 2) } else { $null }
    gpuEnginePercentAtEnd = if ($engine.available -and $engine.values.ContainsKey($processId)) { [math]::Round($engine.values[$processId], 2) } else { $null }
  }
})
$result = [pscustomobject]@{
  startedAt = $started.ToString('o')
  finishedAt = (Get-Date).ToString('o')
  seconds = $Seconds
  intervalSeconds = $IntervalSeconds
  gpuCountersAvailable = @{ dedicated = $dedicated.available; shared = $shared.available; engine = $engine.available }
  note = 'GPU engine is one end-of-run sample; shared gpu-process memory is not attributed to the pet.'
  processes = $summary
}
$json = $result | ConvertTo-Json -Depth 8
if ($OutputPath) {
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, [Text.UTF8Encoding]::new($false))
}
$json
