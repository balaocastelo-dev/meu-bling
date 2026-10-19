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

Write-Host "`n✅ Pronto. Abra https://www.balao.info/sistema" -ForegroundColor Green
