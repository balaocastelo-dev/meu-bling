<#
  MEU BLING — Instalador para Windows (PowerShell)
  ------------------------------------------------
  O que faz:
    1. Verifica/instala o Node.js 22 (via winget) se necessário
    2. Instala as dependências (npm install)
    3. Cria o arquivo .env com segredos aleatórios (se não existir)
    4. Cria o banco de dados SQLite e carrega a configuração inicial (seed)
    5. Compila o frontend (apps/web/dist) para rodar junto com a API
    6. Cria atalhos na Área de Trabalho

  Uso:  clique com o botão direito → "Executar com o PowerShell"
        ou no terminal:  powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 [-Demo]
#>
param(
  [switch]$Demo,      # carrega dados de exemplo (clientes, produtos, vendas, OS) para testar
  [switch]$SemBuild   # pula a compilação do frontend
)

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Raiz

function Passo($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    ✔ $msg" -ForegroundColor Green }
function Aviso($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }

Write-Host @"

  ███╗   ███╗███████╗██╗   ██╗    ██████╗ ██╗     ██╗███╗   ██╗ ██████╗
  ████╗ ████║██╔════╝██║   ██║    ██╔══██╗██║     ██║████╗  ██║██╔════╝
  ██╔████╔██║█████╗  ██║   ██║    ██████╔╝██║     ██║██╔██╗ ██║██║  ███╗
  ██║╚██╔╝██║██╔══╝  ██║   ██║    ██╔══██╗██║     ██║██║╚██╗██║██║   ██║
  ██║ ╚═╝ ██║███████╗╚██████╔╝    ██████╔╝███████╗██║██║ ╚████║╚██████╔╝
  ╚═╝     ╚═╝╚══════╝ ╚═════╝     ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝
          ERP do Balão da Informática — instalação
"@ -ForegroundColor Red

# ---------------------------------------------------------------- 1. Node.js
Passo "Verificando Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
$versaoOk = $false
if ($node) {
  $v = (node -v) -replace 'v',''
  $major = [int]($v.Split('.')[0])
  if ($major -ge 20) { $versaoOk = $true; Ok "Node.js $v encontrado" } else { Aviso "Node.js $v é antigo (precisa 20+)" }
}
if (-not $versaoOk) {
  Aviso "Instalando Node.js LTS via winget (pode pedir confirmação)..."
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements -h
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js não encontrado após a instalação. Feche e abra o PowerShell e rode o instalador novamente." }
  Ok "Node.js $(node -v) instalado"
}

# ---------------------------------------------------------------- 2. Dependências
Passo "Instalando dependências (pode levar alguns minutos)"
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install falhou" }
Ok "Dependências instaladas"

# ---------------------------------------------------------------- 3. .env
Passo "Configurando ambiente"
$envPath = Join-Path $Raiz 'apps\api\.env'
if (-not (Test-Path $envPath)) {
  $rand = { -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ }) }
  @"
DATABASE_URL="file:./data/meubling.db"
PORT=3333
HOST=0.0.0.0
JWT_SECRET="$(& $rand)"
APP_SECRET="$(& $rand)"
APP_URL="http://localhost:3333"
STORAGE_DIR="./storage"
NODE_ENV=production
"@ | Set-Content -Path $envPath -Encoding UTF8
  Ok ".env criado com segredos aleatórios"
} else { Ok ".env já existia (mantido)" }
New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'apps\api\data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'apps\api\storage') | Out-Null

# ---------------------------------------------------------------- 4. Banco
Passo "Criando banco de dados e configuração inicial"
Push-Location (Join-Path $Raiz 'apps\api')
npx prisma db push --skip-generate
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Falha ao criar o banco" }
npx prisma generate | Out-Null
if ($Demo) { npx tsx prisma/seed.ts --demo } else { npx tsx prisma/seed.ts }
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Falha no seed" }
Pop-Location
Ok "Banco pronto em apps\api\data\meubling.db"

# ---------------------------------------------------------------- 5. Frontend
if (-not $SemBuild) {
  Passo "Compilando o frontend"
  Push-Location (Join-Path $Raiz 'apps\web')
  npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Falha ao compilar o frontend" }
  Pop-Location
  Ok "Frontend compilado (apps\web\dist)"
}

# ---------------------------------------------------------------- 6. Atalhos
Passo "Criando atalhos na Área de Trabalho"
$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$atalho = $wsh.CreateShortcut((Join-Path $desktop 'MEU BLING.lnk'))
$atalho.TargetPath = 'powershell.exe'
$atalho.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$Raiz\scripts\iniciar.ps1`""
$atalho.WorkingDirectory = $Raiz
$atalho.IconLocation = 'shell32.dll,43'
$atalho.Description = 'Iniciar o MEU BLING (ERP do Balão)'
$atalho.Save()
$atalhoBk = $wsh.CreateShortcut((Join-Path $desktop 'MEU BLING - Backup.lnk'))
$atalhoBk.TargetPath = 'powershell.exe'
$atalhoBk.Arguments = "-ExecutionPolicy Bypass -File `"$Raiz\scripts\backup.ps1`""
$atalhoBk.WorkingDirectory = $Raiz
$atalhoBk.IconLocation = 'shell32.dll,45'
$atalhoBk.Save()
Ok "Atalhos 'MEU BLING' e 'MEU BLING - Backup' criados"

Write-Host @"

  ✅ Instalação concluída!

  Para iniciar:   clique no atalho "MEU BLING" na Área de Trabalho
                  (ou rode .\scripts\iniciar.ps1)
  Acesso:         http://localhost:3333
  Login inicial:  admin@balao.info   senha: admin123   ← troque no primeiro acesso
  Outros PCs da loja acessam por http://<IP-deste-PC>:3333

"@ -ForegroundColor Green
