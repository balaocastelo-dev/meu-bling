<#
  MEU BLING - Publicar na internet a partir do PC da loja (Cloudflare Tunnel)
  --------------------------------------------------------------------------
  Expõe o sistema com HTTPS sem abrir portas no roteador e sem IP fixo.
  O PC precisa ficar ligado; o MEU BLING precisa estar rodando (atalho "MEU BLING"
  ou serviço criado por instalar-servico.ps1).

  MODOS
    .\scripts\publicar-online.ps1 -Rapido
        → Cria um túnel temporário e mostra uma URL https://....trycloudflare.com
          (não precisa de conta; a URL muda a cada execução). Bom para testar agora.

    .\scripts\publicar-online.ps1 -Dominio erp.balao.info
        → Túnel permanente com o seu domínio (precisa de conta Cloudflare gratuita
          com o domínio balao.info adicionado). Instala como serviço do Windows:
          sobe sozinho quando o PC liga.

  Depois de publicar, ajuste APP_URL no apps\api\.env para a URL pública
  (usada nos links de WhatsApp/e-mail) e reinicie o MEU BLING.
#>
param(
  [switch]$Rapido,
  [string]$Dominio,
  [string]$NomeTunel = 'meu-bling',
  [int]$Porta = 3333
)
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Passo($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "    ✔ $m" -ForegroundColor Green }

# ---- cloudflared
Passo "Verificando cloudflared"
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "    Instalando cloudflared via winget..." -ForegroundColor Yellow
  winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements -h
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared não encontrado. Feche e abra o PowerShell e rode de novo." }
}
Ok "cloudflared $(cloudflared --version)"

# ---- verifica se o sistema está no ar
try { $null = Invoke-WebRequest -UseBasicParsing "http://localhost:$Porta/api/v1/saude" -TimeoutSec 5; Ok "MEU BLING respondendo na porta $Porta" }
catch { Write-Host "    ! O MEU BLING não está rodando na porta $Porta. Inicie pelo atalho 'MEU BLING' antes." -ForegroundColor Yellow }

if ($Rapido) {
  Passo "Abrindo túnel temporário (Ctrl+C para encerrar)"
  Write-Host "    A URL pública aparece abaixo em 'https://xxxx.trycloudflare.com'." -ForegroundColor DarkGray
  cloudflared tunnel --url "http://localhost:$Porta"
  exit 0
}

if (-not $Dominio) { throw "Informe -Rapido (teste) ou -Dominio seu.dominio.com.br (permanente)." }

# ---- túnel permanente
Passo "Login na Cloudflare (abre o navegador - escolha o domínio $($Dominio.Split('.')[-2..-1] -join '.'))"
cloudflared tunnel login

Passo "Criando túnel '$NomeTunel'"
$lista = cloudflared tunnel list 2>$null
if ($lista -notmatch $NomeTunel) { cloudflared tunnel create $NomeTunel }
$idLinha = (cloudflared tunnel list | Select-String $NomeTunel | Select-Object -First 1).ToString().Trim()
$tunelId = ($idLinha -split '\s+')[0]
Ok "Túnel $tunelId"

Passo "Roteando DNS $Dominio → túnel"
cloudflared tunnel route dns $NomeTunel $Dominio 2>&1 | Out-Null
Ok "DNS configurado"

Passo "Gravando configuração"
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
$cred = Join-Path $cfDir "$tunelId.json"
$config = Join-Path $cfDir 'config.yml'
@"
tunnel: $tunelId
credentials-file: $cred
ingress:
  - hostname: $Dominio
    service: http://localhost:$Porta
  - service: http_status:404
"@ | Set-Content -Path $config -Encoding UTF8
Ok $config

Passo "Instalando como serviço do Windows (inicia com o PC)"
cloudflared service uninstall 2>$null | Out-Null
cloudflared --config $config service install
Start-Service cloudflared -ErrorAction SilentlyContinue
Ok "Serviço cloudflared ativo"

# ---- APP_URL
$envPath = Join-Path $Raiz 'apps\api\.env'
if (Test-Path $envPath) {
  (Get-Content $envPath) -replace '^APP_URL=.*$', "APP_URL=`"https://$Dominio`"" | Set-Content $envPath -Encoding UTF8
  Ok "APP_URL atualizado para https://$Dominio (reinicie o MEU BLING)"
}

Write-Host @"

  ✅ Publicado!  https://$Dominio
  - Acesse de qualquer lugar; o login do sistema controla quem entra (perfis).
  - Para proteger ainda mais, ative o Cloudflare Access (Zero Trust) para esse host
    e exija e-mail @balao.info ou código por e-mail antes de chegar ao sistema.
  - Mantenha o PC ligado; crie o serviço do MEU BLING com .\scripts\instalar-servico.ps1

"@ -ForegroundColor Green
