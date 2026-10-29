<#
  MEU BLING - Iniciar o sistema (produção local)
  Sobe a API (que também serve o frontend compilado) em http://localhost:3333
  e abre o navegador. Feche esta janela para parar o sistema.

  Modo desenvolvedor (recarga automática, frontend em :5173):
      .\scripts\iniciar.ps1 -Dev
#>
param([switch]$Dev)
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Raiz
$Host.UI.RawUI.WindowTitle = 'MEU BLING - servidor (feche para parar)'

if (-not (Test-Path (Join-Path $Raiz 'node_modules'))) {
  Write-Host "Dependências não instaladas. Rode primeiro: .\scripts\instalar.ps1" -ForegroundColor Yellow
  exit 1
}

# Mostra o IP local para acesso de outros PCs da loja
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  MEU BLING iniciando..." -ForegroundColor Red
Write-Host "  Local:      http://localhost:3333" -ForegroundColor Green
if ($ip) { Write-Host "  Rede local: http://$ip`:3333" -ForegroundColor Green }
Write-Host "  (feche esta janela para parar)" -ForegroundColor DarkGray
Write-Host ""

if ($Dev) {
  Start-Job -ScriptBlock { Start-Sleep 6; Start-Process 'http://localhost:5173' } | Out-Null
  npm run dev
} else {
  if (-not (Test-Path (Join-Path $Raiz 'apps\web\dist\index.html'))) {
    Write-Host "Frontend não compilado - compilando agora..." -ForegroundColor Yellow
    Push-Location (Join-Path $Raiz 'apps\web'); npm run build; Pop-Location
  }
  Start-Job -ScriptBlock { Start-Sleep 4; Start-Process 'http://localhost:3333' } | Out-Null
  Push-Location (Join-Path $Raiz 'apps\api')
  $env:NODE_ENV = 'production'
  npx tsx src/server.ts
  Pop-Location
}
