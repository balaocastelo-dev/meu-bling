<#
  MEU BLING — Rodar como serviço (inicia sozinho quando o Windows liga, sem precisar logar)
  Cria uma Tarefa Agendada "MEU BLING" que executa o servidor em segundo plano na inicialização.
  Rode como Administrador:  powershell -ExecutionPolicy Bypass -File .\scripts\instalar-servico.ps1
  Para remover:             .\scripts\instalar-servico.ps1 -Remover
#>
param([switch]$Remover)
$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nome = 'MEU BLING'

if ($Remover) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "✔ Tarefa '$nome' removida." -ForegroundColor Green
  exit 0
}

$node = (Get-Command node).Source
$npx = Join-Path (Split-Path $node) 'npx.cmd'
$acao = New-ScheduledTaskAction -Execute $npx -Argument 'tsx src/server.ts' -WorkingDirectory (Join-Path $Raiz 'apps\api')
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config -Principal $principal -Description 'Servidor do ERP MEU BLING (porta 3333)' | Out-Null
Start-ScheduledTask -TaskName $nome
Write-Host "✔ Serviço '$nome' instalado e iniciado. Ele reinicia sozinho se cair e sobe junto com o Windows." -ForegroundColor Green
Write-Host "  Logs: Visualizador de Eventos → Agendador de Tarefas. Para parar: Stop-ScheduledTask -TaskName '$nome'" -ForegroundColor DarkGray
