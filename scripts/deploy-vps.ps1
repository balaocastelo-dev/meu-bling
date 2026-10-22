<#
  MEU BLING — Publicar na VPS do Balão (Hostinger) em https://www.balao.info/sistema
  --------------------------------------------------------------------------------
  O que faz:
    1. Empacota o código desta pasta (git archive, sem node_modules) e envia por SSH para /opt/meu-bling na VPS
    2. Roda deploy/vps/instalar-vps.sh lá (Docker build, container, rota /sistema no Caddy)

  A senha de root da VPS é pedida pelo próprio SSH (2 vezes: envio + instalação). Nunca fica em arquivo.
  Para não digitar senha: ssh-keygen (uma vez) e copie a chave: type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@179.199.148.87 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

  Uso:  powershell -ExecutionPolicy Bypass -File .\scripts\deploy-vps.ps1
        .\scripts\deploy-vps.ps1 -Servidor outro.ip.ou.host
#>
param(
  [string]$Servidor = $(if ($env:VPS_HOST) { $env:VPS_HOST } else { '179.199.148.87' }),
  [string]$Usuario = 'root'
)
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Raiz

function Passo($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git não encontrado. Instale: winget install Git.Git" }
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw "ssh não encontrado (OpenSSH do Windows: Configurações → Aplicativos → Recursos opcionais)" }

Passo "Enviando o código para $Usuario@${Servidor}:/opt/meu-bling (git archive → tar via ssh)"
# cmd.exe é usado de propósito: o PowerShell 5 corrompe bytes ao encadear comandos binários.
$cmd = "git archive --format=tar HEAD | ssh $Usuario@$Servidor `"mkdir -p /opt/meu-bling && tar -x -C /opt/meu-bling`""
cmd.exe /c $cmd
if ($LASTEXITCODE -ne 0) { throw "Falha ao enviar o código (exit $LASTEXITCODE)" }

Passo "Instalando na VPS (Docker + Caddy)"
ssh "$Usuario@$Servidor" "bash /opt/meu-bling/deploy/vps/instalar-vps.sh"
if ($LASTEXITCODE -ne 0) { throw "O instalador na VPS terminou com erro (exit $LASTEXITCODE)" }

Passo "Ligação do PDV do site (www.balao.info/pdv -> /sistema)"
# A chave fica só na VPS e na Vercel: vai direto para a área de transferência, nunca para a tela.
$chave = (ssh "$Usuario@$Servidor" "grep -m1 '^SITE_CHAVE_INTEGRACAO=' /etc/meu-bling.env | cut -d= -f2-") | Select-Object -First 1
if ($chave -and $chave.Trim().Length -ge 24) {
  $marca = Join-Path $Raiz '.chave-site-enviada'
  $sha = New-Object Security.Cryptography.SHA256Managed
  $impressao = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($chave.Trim()))).Replace('-', '').Substring(0, 16)
  if ((Test-Path $marca) -and ((Get-Content $marca -Raw).Trim() -eq $impressao)) {
    Write-Host "A chave do PDV já está na Vercel (levada num deploy anterior). Nada a fazer." -ForegroundColor DarkGray
  } else {
    Set-Clipboard -Value $chave.Trim()
    Write-Host "A chave do PDV foi COPIADA (é só dar Ctrl+V). Falta 1 passo, uma vez só:" -ForegroundColor Yellow
    Write-Host "  Vercel -> projeto do site -> Settings -> Environment Variables -> Add" -ForegroundColor Yellow
    Write-Host "  Nome: MEU_BLING_CHAVE   Valor: Ctrl+V   Ambiente: Production   -> Save -> Redeploy" -ForegroundColor Yellow
    Start-Process "https://vercel.com/dashboard"
    $ok = Read-Host "Digite S quando tiver salvo na Vercel (ou só Enter para fazer depois)"
    if ($ok -match '^[sS]') { Set-Content -Path $marca -Value $impressao; Set-Clipboard -Value ' ' }
  }
} else {
  Write-Host "Não consegui ler a chave do PDV na VPS (SITE_CHAVE_INTEGRACAO). Rode o deploy de novo." -ForegroundColor Red
}

Write-Host "`n✅ Pronto. Abra https://www.balao.info/sistema" -ForegroundColor Green
