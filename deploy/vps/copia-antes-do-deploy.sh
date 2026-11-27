#!/usr/bin/env bash
#
# Cópia comprimida do banco SQLite antes de cada deploy.
# Destino: ${DADOS}/antes-do-deploy/meubling-AAAAMMDDHHMMSS.db.zst
#          (ou .db.gz se o zstd não existir).
#
# O banco no ar está em WAL. Copiar o arquivo com cp pega uma imagem
# cortada (o quick_check acusa "database disk image is malformed").
# Aqui a cópia nasce com sqlite3 ".backup" (se falhar, VACUUM INTO),
# que inclui o que está no -wal. Nunca usamos cp do arquivo aberto.
#
# Ordem:
# 1. Backup consistente.
# 2. PRAGMA quick_check no arquivo ainda sem comprimir. Se não for "ok",
#    a cópia é descartada, nada anterior sai e o instalador não troca o container.
# 3. Comprime, confere com zstd -t ou gzip -t e o tamanho mínimo.
# 4. Só então a retenção. Entram nas 2 vagas só cópias que passaram na
#    conferência (marca em .conferidas/, ou um .db antigo cujo quick_check
#    devolve ok). Cópias sem isso não ocupam vaga e saem depois que a nova passou.
#
# Se não houver espaço para o backup e o arquivo comprimido ao mesmo tempo,
# apaga antes só o que passar das 2 mais recentes e avisa. A única cópia
# existente fica. Se a conferência da nova falhar depois disso, não apaga mais nada.
#
# sqlite3: o do host. Se faltar e este script for root, tenta apt. Se ainda
# faltar, usa o sqlite3 da imagem Docker ${CONTAINER} (sem publicar porta).
# Compressor: zstd; apt se for root e não existir; senão gzip.
#
# Restaurar, com o container parado:
#   bash /opt/meu-bling/deploy/vps/restaurar-antes-do-deploy.sh
#
# Variáveis (a VPS usa o padrão; os testes é que definem as outras):
#   DADOS, BANCO, PASTA, MANTER (padrão 2), CONTAINER (padrão meu-bling)
#   COPIA_MINIMO_BYTES, COPIA_BYTES_LIVRES, COPIA_AGORA
#   COPIA_NAO_INSTALAR_ZSTD=1  COPIA_NAO_INSTALAR_SQLITE=1  COPIA_NAO_USAR_CONTAINER=1

set -euo pipefail

export LC_ALL=C

DADOS="${DADOS:-/var/lib/meu-bling}"
BANCO="${BANCO:-$DADOS/data/meubling.db}"
PASTA="${PASTA:-$DADOS/antes-do-deploy}"
MANTER="${MANTER:-2}"
CONTAINER="${CONTAINER:-meu-bling}"
MARCAS="${PASTA}/.conferidas"

parcial=""
snapshot=""
liberou_espaco=0
MODO_SQLITE=""
MOTIVO_QUICK=""

limpar_incompletos() {
  if [ -n "$parcial" ] && [ -f "$parcial" ]; then
    rm -f -- "$parcial" || true
  fi
  if [ -n "$snapshot" ] && [ -f "$snapshot" ]; then
    rm -f -- "$snapshot" || true
  fi
}
trap limpar_incompletos EXIT

erro() {
  printf '\n[ERRO] %s\n' "$1" >&2
  exit 1
}

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

segundos_entre() {
  awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", (b - a) }'
}

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

tamanho_arquivo() {
  if [ -f "$1" ]; then
    stat -c '%s' "$1"
  else
    printf '0\n'
  fi
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
    rm -f -- "$MARCAS/${caminho##*/}"
    printf 'Apagada: %s (%s)\n' "$caminho" "$(formatar_bytes "$tam")"
    i=$((i + 1))
  done
}

# Imprime "host" ou "container". Mensagens de apt vão para o stderr.
escolher_sqlite() {
  if command -v sqlite3 >/dev/null 2>&1; then
    printf 'host\n'
    return 0
  fi
  if [ "${COPIA_NAO_INSTALAR_SQLITE:-}" != 1 ] && [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    printf 'sqlite3 não encontrado; tentando instalar via apt...\n' >&2
    local log_apt=/tmp/meu-bling-apt-sqlite.log
    if DEBIAN_FRONTEND=noninteractive apt-get update -qq >"$log_apt" 2>&1 \
      && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends sqlite3 >>"$log_apt" 2>&1; then
      hash -r
    else
      printf 'Não consegui instalar o sqlite3 (detalhes em %s).\n' "$log_apt" >&2
    fi
    if command -v sqlite3 >/dev/null 2>&1; then
      printf 'sqlite3 instalado.\n' >&2
      printf 'host\n'
      return 0
    fi
  fi
  if [ "${COPIA_NAO_USAR_CONTAINER:-}" != 1 ] && command -v docker >/dev/null 2>&1 \
    && docker image inspect "$CONTAINER" >/dev/null 2>&1; then
    if docker run --rm --network none --entrypoint sqlite3 "$CONTAINER" -version >/dev/null 2>&1; then
      printf 'Usando o sqlite3 da imagem %s.\n' "$CONTAINER" >&2
      printf 'container\n'
      return 0
    fi
  fi
  return 1
}

escolher_compressor() {
  if command -v zstd >/dev/null 2>&1; then
    printf 'zstd\n'
    return 0
  fi
  if [ "${COPIA_NAO_INSTALAR_ZSTD:-}" != 1 ] && [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    printf 'zstd não encontrado; tentando instalar via apt...\n' >&2
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

# Roda .backup ou VACUUM INTO dentro de um container novo, sem publicar porta.
# A imagem precisa já existir aqui: não puxa nada da internet.
backup_container() {
  local origem=$1
  local destino=$2
  local modo=$3
  local srcdir=${origem%/*}
  local destdir=${destino%/*}
  local base=${origem##*/}
  local destbase=${destino##*/}
  local cmd
  if [ "$modo" = backup ]; then
    cmd=".backup '/dest/${destbase}'"
  else
    cmd="VACUUM INTO '/dest/${destbase}'"
  fi
  docker run --rm --network none --entrypoint sqlite3 \
    -v "$srcdir:/src" \
    -v "$destdir:/dest" \
    "$CONTAINER" \
    "/src/${base}" "$cmd"
}

fazer_backup() {
  local origem=$1
  local destino=$2
  local t0 t1
  rm -f -- "$destino"
  t0=${EPOCHREALTIME:-$(date +%s)}
  if [ "$MODO_SQLITE" = host ]; then
    if ! sqlite3 "$origem" ".backup '$destino'"; then
      printf 'O .backup não concluiu; tentando VACUUM INTO...\n'
      rm -f -- "$destino"
      if ! sqlite3 "$origem" "VACUUM INTO '$destino'"; then
        return 1
      fi
    fi
  else
    if ! backup_container "$origem" "$destino" backup; then
      printf 'O .backup no container não concluiu; tentando VACUUM INTO...\n'
      rm -f -- "$destino"
      if ! backup_container "$origem" "$destino" vacuum; then
        return 1
      fi
    fi
  fi
  t1=${EPOCHREALTIME:-$(date +%s)}
  printf 'Backup consistente em %s s.\n' "$(segundos_entre "$t0" "$t1")"
}

# 0 se a saída do quick_check, sem espaços, for exatamente ok.
quick_check_arquivo() {
  local arq=$1
  local saida t0 t1 limpo dir base
  MOTIVO_QUICK=""
  t0=${EPOCHREALTIME:-$(date +%s)}
  if [ "$MODO_SQLITE" = host ]; then
    saida=$(sqlite3 "$arq" "PRAGMA quick_check;" 2>&1 || true)
  else
    dir=${arq%/*}
    base=${arq##*/}
    saida=$(docker run --rm --network none --entrypoint sqlite3 \
      -v "$dir:/db" \
      "$CONTAINER" \
      "/db/${base}" "PRAGMA quick_check;" 2>&1 || true)
  fi
  t1=${EPOCHREALTIME:-$(date +%s)}
  limpo=${saida//[$' \t\r\n']/}
  if [ "$limpo" = "ok" ]; then
    printf 'PRAGMA quick_check: ok (%s s).\n' "$(segundos_entre "$t0" "$t1")"
    return 0
  fi
  MOTIVO_QUICK=${saida//$'\n'/ }
  MOTIVO_QUICK=${MOTIVO_QUICK:0:180}
  printf 'PRAGMA quick_check falhou (%s s).\n' "$(segundos_entre "$t0" "$t1")" >&2
  return 1
}

marca_de() {
  printf '%s\n' "$MARCAS/${1##*/}"
}

# 0 se esta cópia pode ocupar uma das vagas da retenção.
copia_conferida() {
  local arq=$1
  local marca
  marca=$(marca_de "$arq")
  if [ -f "$marca" ]; then
    return 0
  fi
  case "$arq" in
    *.db.zst|*.db.gz)
      return 1
      ;;
    *.db)
      printf 'Conferindo cópia antiga com PRAGMA quick_check: %s\n' "$arq"
      if quick_check_arquivo "$arq"; then
        mkdir -p "$MARCAS"
        printf 'ok\n' >"$marca"
        return 0
      fi
      printf 'Cópia antiga reprovada no quick_check: %s\n' "$MOTIVO_QUICK"
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

aplicar_retencao() {
  local -a todas=()
  local -A fica=()
  local arq vagas tam total
  mapfile -t todas < <(listar_copias)
  vagas=$MANTER
  for arq in "${todas[@]}"; do
    [ -n "$arq" ] || continue
    if [ "$vagas" -le 0 ]; then
      break
    fi
    if copia_conferida "$arq"; then
      fica["$arq"]=1
      vagas=$((vagas - 1))
      printf 'Válida: %s\n' "$arq"
    else
      printf 'Não passou na conferência e não ocupa vaga: %s\n' "$arq"
    fi
  done
  if [ "${#fica[@]}" -eq 0 ]; then
    printf 'Nenhuma cópia conferida. Nada foi apagado.\n'
    return 0
  fi
  total=${#todas[@]}
  for arq in "${todas[@]}"; do
    [ -n "$arq" ] || continue
    if [ -n "${fica[$arq]:-}" ]; then
      continue
    fi
    if [ "$total" -le 1 ]; then
      printf 'A única cópia restante foi mantida: %s\n' "$arq"
      break
    fi
    tam=$(stat -c '%s' "$arq")
    rm -f -- "$arq"
    rm -f -- "$(marca_de "$arq")"
    printf 'Apagada: %s (%s)\n' "$arq" "$(formatar_bytes "$tam")"
    total=$((total - 1))
  done
  if [ "${#fica[@]}" -eq 1 ]; then
    printf 'Ficou 1 cópia que passou na conferência em %s.\n' "$PASTA"
  else
    printf 'Ficaram %s cópias que passaram na conferência em %s.\n' "${#fica[@]}" "$PASTA"
  fi
  printf 'Cópias que ficaram:\n'
  for arq in "${todas[@]}"; do
    [ -n "${fica[$arq]:-}" ] || continue
    [ -f "$arq" ] || continue
    printf '  %s (%s)\n' "$arq" "$(formatar_bytes "$(stat -c '%s' "$arq")")"
  done
}

conferir_comprimido() {
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

sobras=()
mapfile -t sobras < <(find "$PASTA" -maxdepth 1 -type f \
  \( -name 'meubling-*.parcial' -o -name 'meubling-*.snapshot' \) \
  -printf '%p\n' 2>/dev/null || true)
if [ "${#sobras[@]}" -gt 0 ]; then
  printf 'Removendo %s arquivo(s) de cópia incompleta de uma tentativa anterior.\n' "${#sobras[@]}"
  for caminho_parcial in "${sobras[@]}"; do
    rm -f -- "$caminho_parcial"
    printf 'Removido incompleto: %s\n' "$caminho_parcial"
  done
fi

origem=$(tamanho_arquivo "$BANCO")
if [ "$origem" -lt 1 ]; then
  erro "O banco em ${BANCO} está vazio. Não fiz cópia e não apaguei nada. A versão no ar não foi trocada."
fi

if [ -n "${COPIA_MINIMO_BYTES:-}" ]; then
  exigir_inteiro "$COPIA_MINIMO_BYTES" "COPIA_MINIMO_BYTES"
  if [ "$COPIA_MINIMO_BYTES" -lt 1 ]; then
    falha_sem_trocar "COPIA_MINIMO_BYTES precisa ser um inteiro maior ou igual a 1."
  fi
fi

wal=$(tamanho_arquivo "${BANCO}-wal")
logico=$((origem + wal))
# O .backup grava o banco inteiro e o comprimido fica ao lado até o zstd -t / gzip -t.
preciso=$((logico * 2))

livre=$(bytes_livres)
exigir_inteiro "$livre" "o espaço livre em disco"

if [ "$livre" -lt "$preciso" ]; then
  printf 'AVISO: espaço livre (%s) não cobre a cópia nova (cerca de %s: backup consistente e arquivo comprimido ao mesmo tempo).\n' \
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

MODO_SQLITE=$(escolher_sqlite) || falha_sem_trocar "Não há sqlite3 no host, o apt não instalou e a imagem ${CONTAINER} também não tem. Sem isso a cópia a quente corrompe o banco. Nada foi apagado e a versão no ar não foi trocada."

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
snapshot="$PASTA/meubling-${stamp}.db.snapshot"
parcial="${final}.parcial"

printf 'Gerando cópia consistente com sqlite3 .backup (o banco está em WAL; não uso cp do arquivo aberto)...\n'
if ! fazer_backup "$BANCO" "$snapshot"; then
  rm -f -- "$snapshot" || true
  snapshot=""
  falha_sem_trocar "Não consegui gerar a cópia consistente do banco (sqlite3 .backup / VACUUM INTO)."
fi
if [ ! -s "$snapshot" ]; then
  rm -f -- "$snapshot" || true
  snapshot=""
  falha_sem_trocar "A cópia consistente ficou vazia."
fi
if ! quick_check_arquivo "$snapshot"; then
  rm -f -- "$snapshot" || true
  snapshot=""
  falha_sem_trocar "A cópia nova do banco não passou na conferência: PRAGMA quick_check não devolveu ok (${MOTIVO_QUICK:-sem resposta}). O arquivo incompleto foi descartado."
fi

tam_snap=$(stat -c '%s' "$snapshot")
minimo=$(minimo_razoavel "$tam_snap")

printf 'Comprimindo a cópia já conferida com %s...\n' "$compressor"
if [ "$compressor" = zstd ]; then
  if ! zstd -q -3 -T0 -f -o "$parcial" -- "$snapshot"; then
    if ! zstd -q -3 -f -o "$parcial" -- "$snapshot"; then
      falha_sem_trocar "Não consegui comprimir a cópia com o zstd."
    fi
  fi
else
  if ! gzip -c -n -- "$snapshot" >"$parcial"; then
    falha_sem_trocar "Não consegui comprimir a cópia com o gzip."
  fi
fi

MOTIVO=""
if ! conferir_comprimido "$parcial" "$minimo" "$ext"; then
  rm -f -- "$parcial" || true
  parcial=""
  rm -f -- "$snapshot" || true
  snapshot=""
  falha_sem_trocar "A cópia nova do banco não passou na conferência: ${MOTIVO}. O arquivo incompleto foi descartado."
fi

mv -f -- "$parcial" "$final"
parcial=""
chmod --reference="$BANCO" "$final" 2>/dev/null || true
mkdir -p "$MARCAS"
printf 'ok\n' >"$(marca_de "$final")"
rm -f -- "$snapshot"
snapshot=""
printf 'Cópia conferida: %s (%s; backup consistente %s).\n' \
  "$final" "$(formatar_bytes "$(stat -c '%s' "$final")")" "$(formatar_bytes "$tam_snap")"

aplicar_retencao
