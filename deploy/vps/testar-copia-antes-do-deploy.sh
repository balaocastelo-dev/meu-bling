#!/usr/bin/env bash
#
# Testa a cópia de antes do deploy em pastas temporárias.
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
limpar_temporarios() {
  local d
  for d in "${temporarios[@]}"; do
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

criar_banco() {
  local raiz=$1
  mkdir -p "$raiz/data" "$raiz/antes-do-deploy"
  # Cabeçalho de SQLite de verdade, mais 300 KiB que quase não comprimem
  # (o mínimo padrão de um banco grande é 256 KiB).
  printf 'SQLite format 3\0' >"$raiz/data/meubling.db"
  dd if=/dev/urandom bs=1024 count=300 status=none >>"$raiz/data/meubling.db"
}

# Quatro cópias falsas, com datas diferentes. A mais antiga é .db sem
# compressão (é o formato que encheu o disco da VPS).
plantar_quatro() {
  local pasta=$1
  printf 'antiga-db\n' >"$pasta/meubling-20200101100000.db"
  printf 'antiga-zst\n' >"$pasta/meubling-20200601100000.db.zst"
  printf 'antiga-gz\n' >"$pasta/meubling-20210101100000.db.gz"
  printf 'recente-zst\n' >"$pasta/meubling-20210601100000.db.zst"
  touch -d '2020-01-01 10:00:00' "$pasta/meubling-20200101100000.db"
  touch -d '2020-06-01 10:00:00' "$pasta/meubling-20200601100000.db.zst"
  touch -d '2021-01-01 10:00:00' "$pasta/meubling-20210101100000.db.gz"
  touch -d '2021-06-01 10:00:00' "$pasta/meubling-20210601100000.db.zst"
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

# Roda a cópia. Argumentos extras vão para o env (COPIA_AGORA=..., PATH=...).
# O primeiro argumento é 0 (espera sucesso) ou 1 (espera erro).
rodar_copia() {
  local raiz=$1
  local espera_falha=$2
  shift 2
  local ec
  set +e
  ULTIMA_SAIDA=$(env \
    DADOS="$raiz" \
    COPIA_NAO_INSTALAR_ZSTD=1 \
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
printf 'CASO 1 — Retenção: antes 4 cópias, depois 2\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 0 "COPIA_AGORA=$CARIMBO"

mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
esperado=$(printf '%s\n' \
  "meubling-${CARIMBO}.db.${ext_padrao}" \
  "meubling-20210601100000.db.zst" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "esperava as 2 mais recentes e veio: $obtido"
[ -z "$(find "$raiz/antes-do-deploy" -name '*.parcial' -print)" ] || falhou "sobrou arquivo parcial"

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
cmp -s "$raiz/data/meubling.db" "$restaurado" || falhou "o banco restaurado difere do original"
printf 'sha256 origem:    %s\n' "$(sha256sum "$raiz/data/meubling.db" | awk '{ print $1 }')"
printf 'sha256 restaurado: %s\n' "$(sha256sum "$restaurado" | awk '{ print $1 }')"
printf 'OK: 4 cópias viraram 2, a nova passou na integridade e a restauração confere.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 2 — Conferência falha (zstd -t): não apaga nada\n'
printf '============================================================\n'
printf 'O zstd deste caso é falso: grava a palavra "lixo" e o zstd -t sai com erro.\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
antes=$(nomes "$raiz/antes-do-deploy")

bin_falso="$raiz/bin-falso"
mkdir -p "$bin_falso"
cat >"$bin_falso/zstd" <<'EOF'
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
chmod +x "$bin_falso/zstd"

printf '\n--- saída do script ---\n'
rodar_copia "$raiz" 1 \
  "PATH=$bin_falso:$PATH" \
  "COPIA_AGORA=$CARIMBO" \
  "COPIA_MINIMO_BYTES=1"

mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
depois=$(nomes "$raiz/antes-do-deploy")
[ "$antes" = "$depois" ] || falhou "a lista mudou depois da conferência falhar. Antes: $antes Depois: $depois"
[ -z "$(find "$raiz/antes-do-deploy" -name '*.parcial' -print)" ] || falhou "sobrou arquivo parcial depois da falha"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'zstd -t' || falhou "a mensagem não citou o zstd -t"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'Nenhuma cópia anterior foi apagada' || falhou "a mensagem não disse que as cópias foram mantidas"
printf '%s\n' "$ULTIMA_SAIDA" | grep -q 'versão no ar não foi trocada' || falhou "a mensagem não disse que a versão ficou"
printf 'OK: as 4 cópias continuam no lugar. Nada foi apagado e o script saiu com erro.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 3 — Sem zstd: cai para gzip, confere e restaura\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
path_gzip="$raiz/bin-gzip"
mkdir -p "$path_gzip"
for cmd in gzip find stat sort sed awk df mv rm mkdir date chmod; do
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
  "meubling-20210601100000.db.zst" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "gzip: esperava 2 cópias e veio: $obtido"
restaurado="$raiz/restaurado-gz.db"
# A restauração precisa do gzip de verdade (o PATH restrito fica só na cópia).
DADOS="$raiz" DESTINO_BANCO="$restaurado" CONTAINER="container-teste-inexistente" \
  /bin/bash "$SCRIPT_RESTAURA" "$nova"
cmp -s "$raiz/data/meubling.db" "$restaurado" || falhou "restauração gzip difere do original"
printf 'OK: sem zstd a cópia é .gz, passam só 2, e a restauração confere.\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 4 — Sem espaço: apaga só o excesso além das 2 e não cria cópia\n'
printf '============================================================\n'

raiz=$(novo_raiz)
criar_banco "$raiz"
plantar_quatro "$raiz/antes-do-deploy"
mostrar_pasta "ANTES" "$raiz/antes-do-deploy"
printf '\n--- saída do script (espaço livre forçado em 0) ---\n'
rodar_copia "$raiz" 1 "COPIA_BYTES_LIVRES=0" "COPIA_AGORA=$CARIMBO"
mostrar_pasta "DEPOIS" "$raiz/antes-do-deploy"
esperado=$(printf '%s\n' \
  "meubling-20210601100000.db.zst" \
  "meubling-20210101100000.db.gz" | sort)
obtido=$(nomes "$raiz/antes-do-deploy")
[ "$obtido" = "$esperado" ] || falhou "sem espaço: esperava as 2 mais recentes e veio: $obtido"
printf 'OK: avisou, apagou só o excesso e não trocou a versão (a cópia nova não foi criada).\n'

# ---------------------------------------------------------------------------
printf '\n============================================================\n'
printf 'CASO 5 — Sem espaço e uma cópia só: ela fica\n'
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
