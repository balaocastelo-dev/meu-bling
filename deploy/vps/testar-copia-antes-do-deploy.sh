#!/usr/bin/env bash
#
# Testa a cópia de antes do deploy em pastas temporárias.
# O banco de teste fica em WAL, com uma linha que só existe no -wal,
# para provar que o snapshot vem do .backup e não de um cp a quente.
# Não usa /var/lib/meu-bling e não mexe em nenhum serviço.
#
# Uso: bash deploy/vps/testar-copia-antes-do-deploy.sh

set -euo pipefail

export LC_ALL=C

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT_COPIA="$DIR/copia-antes-do-deploy.sh"
SCRIPT_RESTAURA="$DIR/restaurar-antes-do-deploy.sh"
CARIMBO=20261127150000

falhou() {
  printf '\n[FALHA NO TESTE] %s\n' "$1" >&2
  exit 1
}

temporarios=()
pids_sqlite=()
limpar_temporarios() {
  local p d
  exec 3>&- 2>/dev/null || true
  for p in "${pids_sqlite[@]+"${pids_sqlite[@]}"}"; do
    kill "$p" 2>/dev/null || true
  done
  for d in "${temporarios[@]+"${temporarios[@]}"}"; do
    rm -rf -- "$d"
  done
}
trap limpar_temporarios EXIT

novo_raiz() {
  local d
  d=$(mktemp -d)
  case "$d" in
    /tmp/*|/var/tmp/*) ;;
    *) falhou "pasta temporária inesperada: $d" ;;
  esac
  temporarios+=("$d")
  printf '%s\n' "$d"
}

# Deixa um sqlite3 segurando o banco em WAL, com 'so-no-wal' ainda no -wal.
criar_banco() {
  local raiz=$1
  local db fifo pronto
  mkdir -p "$raiz/data" "$raiz/antes-do-deploy"
  db="$raiz/data/meubling.db"
  fifo="$raiz/comandos"
  pronto="$raiz/pronto"
  mkfifo "$fifo"
  sqlite3 "$db" <"$fifo" >"$raiz/cli.out" 2>&1 &
  pids_sqlite+=("$!")
  exec 3>"$fifo"
  {
    printf '%s\n' \
      "PRAGMA journal_mode=WAL;" \
      "PRAGMA wal_autocheckpoint=0;" \
      "CREATE TABLE marca (id INTEGER PRIMARY KEY, valor TEXT);" \
      "INSERT INTO marca (valor) VALUES ('ja-no-arquivo');" \
      "PRAGMA wal_checkpoint(TRUNCATE);" \
      "INSERT INTO marca (valor) VALUES ('so-no-wal');"
    printf '.once %s\n' "$pronto"
    printf '%s\n' "SELECT 'pronto';"
  } >&3
  local _
  for _ in $(seq 1 50); do
    [ -s "$pronto" ] && break
    sleep 0.05
  done
  [ -s "$pronto" ] || falhou "o banco de teste não ficou pronto"
  [ -f "${db}-wal" ] || falhou "WAL não apareceu"
}

# Quatro cópias. A mais recente antiga imita a da VPS de 27/11: parece SQLite
# e o quick_check não devolve ok. A mais antiga é um banco de verdade.
plantar_quatro() {
  local pasta=$1
  sqlite3 "$pasta/meubling-20200101100000.db" "CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);"
  printf 'antiga-zst\n' >"$pasta/meubling-20200601100000.db.zst"
  printf 'antiga-gz\n' >"$pasta/meubling-20210101100000.db.gz"
  printf 'SQLite format 3\0' >"$pasta/meubling-20210601100000.db"
  dd if=/dev/urandom bs=1024 count=4 status=none >>"$pasta/meubling-20210601100000.db"
  touch -d '2020-01-01 10:00:00' "$pasta/meubling-20200101100000.db"
  touch -d '2020-06-01 10:00:00' "$pasta/meubling-20200601100000.db.zst"
  touch -d '2021-01-01 10:00:00' "$pasta/meubling-20210101100000.db.gz"
  touch -d '2021-06-01 10:00:00' "$pasta/meubling-20210601100000.db"
}

mostrar_pasta() {
  local titulo=$1
  local pasta=$2
  local n
  n=$(find "$pasta" -maxdepth 1 -type f | wc -l | tr -d ' ')
  printf '\n--- %s (%s arquivo(s)) ---\n' "$titulo" "$n"
  ls -lht --time-style=long-iso "$pasta"
}

nomes() {
  find "$1" -maxdepth 1 -type f -printf '%f\n' | sort
}

rodar_copia() {
  local raiz=$1
  local espera_falha=$2
  shift 2
  local ec
  set +e
  ULTIMA_SAIDA=$(env \
    DADOS="$raiz" \
    COPIA_NAO_INSTALAR_ZSTD=1 \
    COPIA_NAO_INSTALAR_SQLITE=1 \
    COPIA_NAO_USAR_CONTAINER=1 \
    COPIA_MINIMO_BYTES=1 \
    "$@" \
    /bin/bash "$SCRIPT_COPIA" 2>&1)
  ec=$?
  set -e
  printf '%s\n' "$ULTIMA_SAIDA"
  printf 'exit=%s\n' "$ec"
  if [ "$espera_falha" -eq 1 ]; then
    [ "$ec" -ne 0 ] || falhou "a cópia deveria ter falhado e saiu com 0"
  else
    [ "$ec" -eq 0 ] || falhou "a cópia deveria ter passado e saiu com $ec"
  fi
}

conferir_linhas() {
  local restaurado=$1
  local linhas
  linhas=$(sqlite3 "$restaurado" "SELECT valor FROM marca ORDER BY id;")
  printf '%s\n' "$linhas"
  printf '%s\n' "$linhas" | grep -qx 'ja-no-arquivo' || falhou "faltou a linha já checkpoint"
  printf '%s\n' "$linhas" | grep -qx 'so-no-wal' || falhou "faltou a linha que só estava no WAL"
  [ "$(sqlite3 "$restaurado" "PRAGMA quick_check;")" = "ok" ] || falhou "quick_check da restauração"
}

printf 'Teste local com pastas temporárias. Não usa /var/lib/meu-bling e não mexe em serviço nenhum.\n'

if command -v shellcheck >/dev/null 2>&1; then
  printf '\n======== shellcheck ========\n'
  shellcheck "$SCRIPT_COPIA" "$SCRIPT_RESTAURA" "$0"
  printf 'shellcheck: ok\n'
else
  printf '\n(shellcheck não está instalado neste ambiente)\n'
fi

ext_padrao=gz
if command -v zstd >/dev/null 2>&1; then
  ext_padrao=zst
fi
printf '\nCompressor disponível para o caso feliz: %s\n' "$ext_padrao"

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 1 — 4 cópias; a mais recente antiga falha no quick_check; ficam 2 válidas\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
printf '\nquick_check da cópia mais recente antiga (meubling-20210601100000.db):\n'
sqlite3 "$raiz/antes-do-deploy/meubling-20210601100000.db" "PRAGMA quick_check;" || true
printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 0 "COPIA_AGORA=$CARIMBO"

mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
esperado=$(printf '%s\n' \
  "meubling-${CARIMBO}.db.${ext_padrao}" \
  "meubling-20200101100000.db" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "esperava a cópia nova e a antiga que passa no quick_check, veio: $obtido"
[ ! -e "$raiz/antes-do-deploy/meubling-20210601100000.db" ] || falhou "a cópia malformada continuou no disco"
[ -z "$(find "$raiz/antes-do-deploy" \( -name '*.parcial' -o -name '*.snapshot' \) -print)" ] || falhou "sobrou arquivo incompleto"
[ -f "$raiz/antes-do-deploy/.conferidas/meubling-${CARIMBO}.db.${ext_padrao}" ] || falhou "faltou a marca de conferência"

nova="$raiz/antes-do-deploy/meubling-${CARIMBO}.db.${ext_padrao}"
if [ "$ext_padrao" = zst ]; then
  zstd -t -q -- "$nova"
  printf 'zstd -t na cópia nova: ok\n'
else
  gzip -t -- "$nova"
  printf 'gzip -t na cópia nova: ok\n'
fi

restaurado="$raiz/restaurado.db"
printf '\n--- restauração da cópia nova ---\n'
DADOS="$raiz" DESTINO_BANCO="$restaurado" CONTAINER="container-teste-inexistente" \
  /bin/bash "$SCRIPT_RESTAURA" "$nova"
conferir_linhas "$restaurado"
printf 'OK: a linha do WAL entrou na cópia, a malformada saiu, ficaram 2 válidas.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 2 — quick_check da cópia nova falha: não apaga nada\n'
printf '============================================================\n'
printf 'O sqlite3 deste caso é falso: o .backup grava lixo e o quick_check devolve "database disk image is malformed".\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
antes=$(nomes "$raiz/antes-do-deploy")

bin_falso="$raiz/bin-sqlite"
mkdir -p "$bin_falso"
cat >"$bin_falso/sqlite3" <<'EOF'
#!/usr/bin/env bash
cmd=${2-}
case "$cmd" in
  .backup\ *)
    dest=${cmd#.backup }
    dest=${dest#\'}
    dest=${dest%\'}
    printf 'SQLite format 3\0' >"$dest"
    exit 0
    ;;
  VACUUM\ INTO\ *)
    exit 1
    ;;
  *quick_check*)
    printf 'database disk image is malformed\n'
    exit 0
    ;;
  *)
    printf 'sqlite3 falso: comando inesperado\n' >&2
    exit 1
    ;;
esac
EOF
chmod +x "$bin_falso/sqlite3"

printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 1 \
  "PATH=$bin_falso:$PATH" \
  "COPIA_AGORA=$CARIMBO"

mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
depois=$(nomes "$raiz/antes-do-deploy")
[ "$antes" = "$depois" ] || falhou "a lista mudou depois do quick_check falhar. Antes: $antes Depois: $depois"
[ -z "$(find "$raiz/antes-do-deploy" \( -name '*.parcial' -o -name '*.snapshot' \) -print)" ] || falhou "sobrou arquivo incompleto"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'quick_check' || falhou "a mensagem não citou o quick_check"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'database disk image is malformed' || falhou "a mensagem não citou o banco malformado"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'Nenhuma cópia anterior foi apagada' || falhou "a mensagem não disse que as cópias foram mantidas"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'versão no ar não foi trocada' || falhou "a mensagem não disse que a versão ficou"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'Comprimindo' && falhou "comprimiu mesmo com o quick_check reprovado"
printf 'OK: quick_check reprovou, as 4 cópias continuam, nada foi comprimido nem apagado.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 3 — quick_check ok e zstd -t falha: não apaga nada\n'
printf '============================================================\n'
printf 'O zstd deste caso é falso: grava a palavra "lixo" e o zstd -t sai com erro.\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
antes=$(nomes "$raiz/antes-do-deploy")
bin_zstd="$raiz/bin-zstd"
mkdir -p "$bin_zstd"
cat >"$bin_zstd/zstd" <<'EOF'
#!/usr/bin/env bash
saida=""
anterior=""
for arg in "$@"; do
  if [ "$arg" = "-t" ]; then
    exit 1
  fi
  if [ "$anterior" = "-o" ]; then
    saida=$arg
  fi
  anterior=$arg
done
if [ -n "$saida" ]; then
  printf 'lixo' >"$saida"
fi
exit 0
EOF
chmod +x "$bin_zstd/zstd"

printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 1 \
  "PATH=$bin_zstd:$PATH" \
  "COPIA_AGORA=$CARIMBO"
depois=$(nomes "$raiz/antes-do-deploy")
[ "$antes" = "$depois" ] || falhou "a lista mudou depois do zstd -t falhar. Antes: $antes Depois: $depois"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'PRAGMA quick_check: ok' || falhou "o quick_check deveria ter passado antes do zstd"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'zstd -t' || falhou "a mensagem não citou o zstd -t"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'Nenhuma cópia anterior foi apagada' || falhou "apagou cópia anterior"
printf 'OK: o quick_check passou, o zstd -t reprovou, as 4 cópias continuam.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 4 — Sem zstd: cai para gzip, confere e restaura\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
path_gzip="$raiz/bin-gzip"
mkdir -p "$path_gzip"
for cmd in gzip find stat sort sed awk df mv rm mkdir date chmod sqlite3; do
  origem_cmd=$(command -v "$cmd" || true)
  [ -n "$origem_cmd" ] || falhou "comando necessário não encontrado: $cmd"
  ln -s "$origem_cmd" "$path_gzip/$cmd"
done
printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 0 \
  "PATH=$path_gzip" \
  "COPIA_AGORA=$CARIMBO"
nova="$raiz/antes-do-deploy/meubling-${CARIMBO}.db.gz"
[ -f "$nova" ] || falhou "não gerou .db.gz"
gzip -t -- "$nova"
printf 'gzip -t na cópia .gz: ok\n'
mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
esperado=$(printf '%s\n' \
  "meubling-${CARIMBO}.db.gz" \
  "meubling-20200101100000.db" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "gzip: esperava 2 cópias válidas e veio: $obtido"
restaurado="$raiz/restaurado-gz.db"
DADOS="$raiz" DESTINO_BANCO="$restaurado" CONTAINER="container-teste-inexistente" \
  /bin/bash "$SCRIPT_RESTAURA" "$nova"
conferir_linhas "$restaurado"
printf 'OK: sem zstd a cópia é .gz, a linha do WAL voltou e ficaram 2 válidas.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 5 — Sem espaço: apaga só o excesso além das 2 e não cria cópia\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
printf '\n--- saída do script (espaço livre forçado em 0) ---\n'
rodar_copia "$raiz" 1 "COPIA_BYTES_LIVRES=0" "COPIA_AGORA=$CARIMBO"
mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
esperado=$(printf '%s\n' \
  "meubling-20210601100000.db" \
  "meubling-20210101100000.db.gz" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "sem espaço: esperava as 2 mais recentes e veio: $obtido"
printf 'OK: avisou, apagou só o excesso e não chegou a criar a cópia.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 6 — Sem espaço e uma cópia só: ela fica\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
printf 'unica\n' >"$raiz/antes-do-deploy/meubling-20210601100000.db.zst"
touch -d '2021-06-01 10:00:00' "$raiz/antes-do-deploy/meubling-20210601100000.db.zst"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
antes=$(nomes "$raiz/antes-do-deploy")
printf '\n--- saída do script (espaço livre forçado em 0) ---\n'
rodar_copia "$raiz" 1 "COPIA_BYTES_LIVRES=0"
mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
depois=$(nomes "$raiz/antes-do-deploy")
[ "$antes" = "$depois" ] || falhou "a única cópia foi mexida. Antes: $antes Depois: $depois"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'NÃO foi apagada' || falhou "a mensagem não deixou claro que a única cópia ficou"
printf 'OK: a única cópia foi mantida.\n'

printf '\nTodos os casos passaram.\n'
