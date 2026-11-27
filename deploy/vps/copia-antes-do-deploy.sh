#!/usr/bin/env bash
#
# Cópia comprimida do banco SQLite antes de cada deploy.
# Destino: ${DADOS}/antes-do-deploy/meubling-AAAAMMDDHHMMSS.db.zst
#          (ou .db.gz se o zstd não existir).
#
# Regras:
# - Ficam só as 2 cópias mais recentes (data de modificação). Entram na conta
#   .db.zst, .db.gz e a .db antiga sem compressão — senão o disco continua cheio.
# - As antigas só saem DEPOIS que a cópia nova existe, tem tamanho acima do
#   mínimo e passa no teste de integridade (zstd -t ou gzip -t).
# - Se a conferência falhar, nenhuma cópia anterior é apagada e o script
#   termina com erro. O instalar-vps.sh chama isto antes de trocar o container,
#   então a versão no ar continua a mesma.
# - Se não houver espaço para a cópia nova, apaga antes só o que passar das
#   2 mais recentes e avisa. Nunca apaga a única cópia existente.
#
# Compressor: zstd. Se não estiver instalado e este script rodar como root,
# tenta `apt-get install zstd`. Se não der, usa gzip.
#
# Restaurar, com o container parado:
#   bash /opt/meu-bling/deploy/vps/restaurar-antes-do-deploy.sh
# Na mão:
#   zstd -d -c /var/lib/meu-bling/antes-do-deploy/meubling-XXXXXXXX.db.zst \
#     > /var/lib/meu-bling/data/meubling.db
#   gzip -dc /var/lib/meu-bling/antes-do-deploy/meubling-XXXXXXXX.db.gz \
#     > /var/lib/meu-bling/data/meubling.db
#
# Variáveis (a VPS usa o padrão; os testes é que definem as outras):
#   DADOS, BANCO, PASTA, MANTER (padrão 2)
#   COPIA_MINIMO_BYTES   mínimo em bytes da cópia comprimida
#   COPIA_BYTES_LIVRES   substitui o df
#   COPIA_AGORA          carimbo AAAAMMDDHHMMSS no nome do arquivo
#   COPIA_NAO_INSTALAR_ZSTD=1   não chama o apt

set -euo pipefail

# Ordenação e números estáveis (o find não pode trocar o ponto por vírgula).
export LC_ALL=C

DADOS="${DADOS:-/var/lib/meu-bling}"
BANCO="${BANCO:-$DADOS/data/meubling.db}"
PASTA="${PASTA:-$DADOS/antes-do-deploy}"
MANTER="${MANTER:-2}"

# Arquivo .parcial da tentativa atual. O trap apaga se sairmos no meio,
# para não deixar um pedaço grande ocupando o disco. Cópia conferida não
# usa esse nome.
parcial=""
liberou_espaco=0

limpar_parcial() {
  if [ -n "$parcial" ] && [ -f "$parcial" ]; then
    rm -f -- "$parcial" || true
  fi
}
trap limpar_parcial EXIT

erro() {
  printf '\n[ERRO] %s\n' "$1" >&2
  exit 1
}

# Mensagem de falha. Se já tivemos que abrir espaço, não dizemos que nada
# foi apagado — as que restaram (as mais recentes) é que ficam no lugar.
falha_sem_trocar() {
  local detalhe=$1
  if [ "$liberou_espaco" -eq 1 ]; then
    erro "${detalhe} As cópias além das ${MANTER} mais recentes já tinham sido apagadas por falta de espaço; as que restaram não foram mexidas. A versão no ar não foi trocada."
  fi
  erro "${detalhe} Nenhuma cópia anterior foi apagada e a versão no ar não foi trocada."
}

formatar_bytes() {
  local n=$1
  if [ "$n" -ge 1073741824 ]; then
    awk -v n="$n" 'BEGIN { printf "%.1f GB", n / 1073741824 }'
  elif [ "$n" -ge 1048576 ]; then
    awk -v n="$n" 'BEGIN { printf "%.1f MB", n / 1048576 }'
  elif [ "$n" -ge 1024 ]; then
    awk -v n="$n" 'BEGIN { printf "%.1f KB", n / 1024 }'
  else
    printf '%s bytes' "$n"
  fi
}

# Mais recente primeiro. Só cópia com nome final: .parcial fica de fora.
listar_copias() {
  find "$PASTA" -maxdepth 1 -type f \
    \( -name 'meubling-*.db' -o -name 'meubling-*.db.zst' -o -name 'meubling-*.db.gz' \) \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | sed 's/^[^ ]* //' \
    || true
}

bytes_livres() {
  if [ -n "${COPIA_BYTES_LIVRES:-}" ]; then
    printf '%s\n' "$COPIA_BYTES_LIVRES"
    return
  fi
  df -B1 --output=avail "$PASTA" | awk 'NR==2 { print $1 }'
}

exigir_inteiro() {
  local valor=$1
  local nome=$2
  case "$valor" in
    ''|*[!0-9]*)
      falha_sem_trocar "Não consegui ler ${nome} ('${valor:-vazio}')."
      ;;
  esac
}

# 256 KiB recusa arquivo vazio ou cortado no começo de um banco grande
# (o da loja tem alguns GB). Banco pequeno: piso menor, porque o zstd de
# um arquivo curto pode ficar com poucas dezenas de bytes e ainda ser válido.
minimo_razoavel() {
  local origem=$1
  if [ -n "${COPIA_MINIMO_BYTES:-}" ]; then
    printf '%s\n' "$COPIA_MINIMO_BYTES"
    return
  fi
  if [ "$origem" -ge 262144 ]; then
    printf '%s\n' 262144
  elif [ "$origem" -ge 512 ]; then
    printf '%s\n' 512
  else
    printf '%s\n' 1
  fi
}

# Apaga da posição MANTER em diante (0 = a mais recente).
# Não faz nada se houver uma cópia só — essa nunca é apagada.
apagar_alem_de() {
  local manter=$1
  local -a lista=()
  local n i caminho tam
  mapfile -t lista < <(listar_copias)
  n=${#lista[@]}
  if [ "$n" -le 1 ]; then
    return 0
  fi
  if [ "$manter" -lt 1 ]; then
    manter=1
  fi
  i=$manter
  while [ "$i" -lt "$n" ]; do
    caminho=${lista[$i]}
    tam=$(stat -c '%s' "$caminho")
    rm -f -- "$caminho"
    printf 'Apagada: %s (%s)\n' "$caminho" "$(formatar_bytes "$tam")"
    i=$((i + 1))
  done
}

mostrar_restantes() {
  local caminho tam
  printf 'Cópias que ficaram:\n'
  while IFS= read -r caminho; do
    [ -n "$caminho" ] || continue
    tam=$(stat -c '%s' "$caminho")
    printf '  %s (%s)\n' "$caminho" "$(formatar_bytes "$tam")"
  done < <(listar_copias)
}

conferir_copia() {
  local arq=$1
  local minimo=$2
  local ext=$3
  local tam
  MOTIVO=""
  if [ ! -f "$arq" ]; then
    MOTIVO="o arquivo da cópia nova não existe"
    return 1
  fi
  tam=$(stat -c '%s' "$arq")
  if [ "$tam" -lt "$minimo" ]; then
    MOTIVO="o tamanho ($(formatar_bytes "$tam")) está abaixo do mínimo razoável ($(formatar_bytes "$minimo"))"
    return 1
  fi
  case "$ext" in
    zst)
      if ! zstd -t -q -- "$arq" 2>/dev/null; then
        MOTIVO="o teste de integridade (zstd -t) falhou: o arquivo está corrompido ou incompleto"
        return 1
      fi
      ;;
    gz)
      if ! gzip -t -- "$arq" 2>/dev/null; then
        MOTIVO="o teste de integridade (gzip -t) falhou: o arquivo está corrompido ou incompleto"
        return 1
      fi
      ;;
    *)
      MOTIVO="extensão de compressão desconhecida"
      return 1
      ;;
  esac
  return 0
}

# zstd se existir (ou se der para instalar). Senão gzip. Imprime o nome.
escolher_compressor() {
  if command -v zstd >/dev/null 2>&1; then
    printf 'zstd\n'
    return 0
  fi
  if [ "${COPIA_NAO_INSTALAR_ZSTD:-}" != 1 ] && [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    printf 'zstd não encontrado; tentando instalar via apt...\n' >&2
    # A saída do apt fica num log: o nome do compressor sai sozinho no
    # stdout (quem chama captura com $(...)). O log não tem segredo.
    local log_apt=/tmp/meu-bling-apt-zstd.log
    if DEBIAN_FRONTEND=noninteractive apt-get update -qq >"$log_apt" 2>&1 \
      && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends zstd >>"$log_apt" 2>&1; then
      hash -r
    else
      printf 'Não consegui instalar o zstd (detalhes em %s). Vou comprimir com gzip.\n' "$log_apt" >&2
    fi
    if command -v zstd >/dev/null 2>&1; then
      printf 'zstd instalado.\n' >&2
      printf 'zstd\n'
      return 0
    fi
  fi
  if command -v gzip >/dev/null 2>&1; then
    printf 'gzip\n'
    return 0
  fi
  return 1
}

case "$MANTER" in
  ''|*[!0-9]*) erro "MANTER inválido (${MANTER}). Use um inteiro maior ou igual a 1. Nada foi apagado e a versão no ar não foi trocada." ;;
esac
if [ "$MANTER" -lt 1 ]; then
  erro "MANTER inválido (${MANTER}). Use um inteiro maior ou igual a 1. Nada foi apagado e a versão no ar não foi trocada."
fi

if [ ! -f "$BANCO" ]; then
  printf 'Banco ainda não existe em %s — nada para copiar.\n' "$BANCO"
  exit 0
fi

mkdir -p "$PASTA"

# Tentativa anterior interrompida. Não é cópia conferida, então não entra
# na retenção — e não pode continuar ocupando o disco.
parciais=()
mapfile -t parciais < <(find "$PASTA" -maxdepth 1 -type f -name 'meubling-*.parcial' -printf '%p\n' 2>/dev/null || true)
if [ "${#parciais[@]}" -gt 0 ]; then
  printf 'Removendo %s arquivo(s) de cópia incompleta de uma tentativa anterior.\n' "${#parciais[@]}"
  for caminho_parcial in "${parciais[@]}"; do
    rm -f -- "$caminho_parcial"
    printf 'Removido incompleto: %s\n' "$caminho_parcial"
  done
fi

origem=$(stat -c '%s' "$BANCO")
if [ "$origem" -lt 1 ]; then
  erro "O banco em ${BANCO} está vazio. Não fiz cópia e não apaguei nada. A versão no ar não foi trocada."
fi

if [ -n "${COPIA_MINIMO_BYTES:-}" ]; then
  exigir_inteiro "$COPIA_MINIMO_BYTES" "COPIA_MINIMO_BYTES"
  if [ "$COPIA_MINIMO_BYTES" -lt 1 ]; then
    falha_sem_trocar "COPIA_MINIMO_BYTES precisa ser um inteiro maior ou igual a 1."
  fi
fi

# Pior caso: os dados quase não comprimem e o arquivo fica perto do original.
# O cabeçalho do zstd/gzip em um banco grande é pequeno. Se a escrita mesmo
# assim encher o disco, a conferência falha e as cópias que ficaram não saem.
preciso=$origem
minimo=$(minimo_razoavel "$origem")

livre=$(bytes_livres)
exigir_inteiro "$livre" "o espaço livre em disco"

if [ "$livre" -lt "$preciso" ]; then
  printf 'AVISO: espaço livre (%s) não cobre a cópia nova (cerca de %s, o tamanho do banco).\n' \
    "$(formatar_bytes "$livre")" "$(formatar_bytes "$preciso")"
  existentes=()
  mapfile -t existentes < <(listar_copias)
  qtd=${#existentes[@]}
  if [ "$qtd" -eq 0 ]; then
    erro "Não há espaço livre para a cópia nova e não existe cópia antiga para apagar. Nada foi apagado. Libere espaço em disco e rode o instalador de novo. A versão no ar não foi trocada."
  fi
  if [ "$qtd" -eq 1 ]; then
    erro "Não há espaço livre para a cópia nova e só existe uma cópia anterior. Ela NÃO foi apagada. Libere espaço em disco e rode o instalador de novo. A versão no ar não foi trocada."
  fi
  if [ "$qtd" -le "$MANTER" ]; then
    erro "Não há espaço livre para a cópia nova e não há cópia além das ${MANTER} mais recentes para apagar. Nada foi apagado. Libere espaço em disco e rode o instalador de novo. A versão no ar não foi trocada."
  fi
  printf 'Apagando só as cópias além das %s mais recentes para liberar espaço...\n' "$MANTER"
  apagar_alem_de "$MANTER"
  restantes=()
  mapfile -t restantes < <(listar_copias)
  depois=${#restantes[@]}
  apagadas=$((qtd - depois))
  liberou_espaco=1
  if [ "$apagadas" -eq 1 ]; then
    printf 'AVISO: 1 cópia antiga foi apagada para liberar espaço. As %s mais recentes foram mantidas.\n' "$depois"
  else
    printf 'AVISO: %s cópias antigas foram apagadas para liberar espaço. As %s mais recentes foram mantidas.\n' "$apagadas" "$depois"
  fi
  livre=$(bytes_livres)
  exigir_inteiro "$livre" "o espaço livre em disco"
  if [ "$livre" -lt "$preciso" ]; then
    erro "Mesmo depois de apagar o excesso, o espaço livre ($(formatar_bytes "$livre")) não cobre a cópia nova ($(formatar_bytes "$preciso")). As cópias mais recentes foram mantidas. A versão no ar não foi trocada."
  fi
fi

compressor=$(escolher_compressor) || falha_sem_trocar "Nem zstd nem gzip estão disponíveis para comprimir o banco."
case "$compressor" in
  zstd) ext=zst ;;
  gzip)
    ext=gz
    printf 'zstd não está disponível; usando gzip.\n'
    ;;
  *) falha_sem_trocar "Compressor desconhecido (${compressor})." ;;
esac

stamp="${COPIA_AGORA:-$(date +%Y%m%d%H%M%S)}"
final="$PASTA/meubling-${stamp}.db.${ext}"
if [ -e "$final" ]; then
  stamp="${stamp}-$$"
  final="$PASTA/meubling-${stamp}.db.${ext}"
fi
parcial="${final}.parcial"

printf 'Comprimindo o banco com %s...\n' "$compressor"
if [ "$compressor" = zstd ]; then
  if ! zstd -q -3 -T0 -f -o "$parcial" -- "$BANCO"; then
    if ! zstd -q -3 -f -o "$parcial" -- "$BANCO"; then
      falha_sem_trocar "Não consegui comprimir o banco com o zstd."
    fi
  fi
else
  if ! gzip -c -n -- "$BANCO" >"$parcial"; then
    falha_sem_trocar "Não consegui comprimir o banco com o gzip."
  fi
fi

MOTIVO=""
if ! conferir_copia "$parcial" "$minimo" "$ext"; then
  rm -f -- "$parcial" || true
  parcial=""
  falha_sem_trocar "A cópia nova do banco não passou na conferência: ${MOTIVO}. O arquivo incompleto foi descartado."
fi

mv -f -- "$parcial" "$final"
parcial=""
chmod --reference="$BANCO" "$final" 2>/dev/null || true
printf 'Cópia conferida: %s (%s; banco de origem %s).\n' \
  "$final" "$(formatar_bytes "$(stat -c '%s' "$final")")" "$(formatar_bytes "$origem")"

existentes=()
mapfile -t existentes < <(listar_copias)
qtd=${#existentes[@]}
if [ "$qtd" -gt "$MANTER" ]; then
  apagar_alem_de "$MANTER"
  printf 'Mantidas as %s cópias mais recentes em %s.\n' "$MANTER" "$PASTA"
elif [ "$qtd" -eq 1 ]; then
  printf 'Há 1 cópia em %s. Nada a apagar.\n' "$PASTA"
else
  printf 'Há %s cópias em %s (limite %s). Nada a apagar.\n' "$qtd" "$PASTA" "$MANTER"
fi
mostrar_restantes
