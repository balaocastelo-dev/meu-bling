<#
  MEU BLING - Backup
  Copia o banco (SQLite) e a pasta storage (XMLs de NF-e, DANFEs, anexos, sessão do WhatsApp)
  para  Área de Trabalho\MEU BLING Backups\backup-AAAA-MM-DD_HHmm.zip
  Pode ser agendado no Agendador de Tarefas do Windows (diário).
#>
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$destino = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MEU BLING Backups'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$nome = "backup-$(Get-Date -Format 'yyyy-MM-dd_HHmm').zip"
$tmp = Join-Path $env:TEMP "meubling-backup-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item (Join-Path $Raiz 'apps\api\data') (Join-Path $tmp 'data') -Recurse -Force
Copy-Item (Join-Path $Raiz 'apps\api\storage') (Join-Path $tmp 'storage') -Recurse -Force
Copy-Item (Join-Path $Raiz 'apps\api\.env') (Join-Path $tmp '.env') -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath (Join-Path $destino $nome) -Force
Remove-Item $tmp -Recurse -Force
# mantém os 30 backups mais recentes
Get-ChildItem $destino -Filter 'backup-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
Write-Host "✔ Backup salvo em: $(Join-Path $destino $nome)" -ForegroundColor Green
