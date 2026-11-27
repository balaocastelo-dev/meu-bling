#!/usr/bin/env bash
#
# Restaura o banco a partir de uma cópia de antes do deploy.
# Aceita os três formatos que podem estar em /var/lib/meu-bling/antes-do-deploy:
#   meubling-AAAAMMDDHHMMSS.db.zst   (zstd, o padrão atual)
#   meubling-AAAAMMDDHHMMSS.db.gz    (gzip, se o zstd não estava instalado)
#   meubling-AAAAMMDDHHMMSS.db       (cópia antiga, sem compressão)
#
# Não para o container sozinho e não mexe em outros serviços.
# Com o MEU BLING parado:
#   docker stop meu-bling
#   bash /opt/meu-bling/deploy/vps/restaurar-antes-do-deploy.sh
#   docker start meu-bling
#
# Uma cópia específica (em vez da mais recente):
#   bash /opt/meu-bling/deploy/vps/restaurar-antes-do-deploy.sh /var/lib/meu-bling/antes-do-deploy/meubling-XXXXXXXX.db.zst
#
# Variáveis: DADOS, PASTA, DESTINO_BANCO, CONTAINER (padrão meu-bling).

set -euo pipefail

export LC_ALL=C

DADOS="${DADOS:-/var/lib/meu-bling}"
PASTA="${PASTA:-$DADOS/antes-do-deploy}"
DESTINO="${DESTINO_BANCO:-$DADOS/data/meubling.db}"
CONTAINER="${CONTAINER:-meu-bling}"

erro() {
  printf '\n[ERRO] %s\n' "$1" >&2
  exit 1
}

if command -v docker >/dev/null 2>&1; then
  rodando="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
  if [ "$rodando" = "true" ]; then
    erro "O container ${CONTAINER} está no ar. Pare com 'docker stop ${CONTAINER}', rode a restauração e suba de novo com 'docker start ${CONTAINER}'. O banco não foi alterado."
  fi
fi

copia_mais_recente() {
  find "$PASTA" -maxdepth 1 -type f \
    \( -name 'meubling-*.db' -o -name 'meubling-*.db.zst' -o -name 'meubling-*.db.gz' \) \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | sed 's/^[^ ]* //' \
    | head -n 1 \
    || true
}

origem=${1:-}
if [ -z "$origem" ]; then
  [ -d "$PASTA" ] || erro "A pasta de cópias não existe: ${PASTA}. O banco não foi alterado."
  origem=$(copia_mais_recente)
  [ -n "$origem" ] || erro "Nenhuma cópia em ${PASTA}. O banco não foi alterado."
  printf 'Usando a cópia mais recente: %s\n' "$origem"
fi

[ -f "$origem" ] || erro "Arquivo não encontrado: ${origem}. O banco não foi alterado."

case "$origem" in
  *.db.zst)
    command -v zstd >/dev/null 2>&1 || erro "Esta cópia é zstd e o zstd não está instalado. O banco não foi alterado."
    if ! zstd -t -q -- "$origem" 2>/dev/null; then
      erro "A cópia não passou no teste de integridade (zstd -t). O banco não foi alterado."
    fi
    ;;
  *.db.gz)
    command -v gzip >/dev/null 2>&1 || erro "Esta cópia é gzip e o gzip não está instalado. O banco não foi alterado."
    if ! gzip -t -- "$origem" 2>/dev/null; then
      erro "A cópia não passou no teste de integridade (gzip -t). O banco não foi alterado."
    fi
    ;;
  *.db) ;;
  *)
    erro "Formato não reconhecido (use .db.zst, .db.gz ou .db): ${origem}. O banco não foi alterado."
    ;;
esac

mkdir -p "$(dirname "$DESTINO")"
tmp="${DESTINO}.restaurando"
rm -f -- "$tmp"
limpar_tmp() {
  if [ -n "${tmp:-}" ] && [ -f "$tmp" ]; then
    rm -f -- "$tmp" || true
  fi
}
trap limpar_tmp EXIT

if ! {
  case "$origem" in
    *.db.zst) zstd -d -c -q -- "$origem" >"$tmp" ;;
    *.db.gz) gzip -dc -- "$origem" >"$tmp" ;;
    *.db) cp -f -- "$origem" "$tmp" ;;
  esac
}; then
  erro "Não consegui abrir a cópia. O banco atual não foi alterado."
fi

magic=$(head -c 15 -- "$tmp" 2>/dev/null || true)
if [ "$magic" != "SQLite format 3" ]; then
  rm -f -- "$tmp"
  erro "O arquivo descomprimido não é um banco SQLite. O banco atual não foi alterado."
fi

mv -f -- "$tmp" "$DESTINO"
chmod --reference="$origem" "$DESTINO" 2>/dev/null || true
printf 'Banco restaurado em %s (%s).\n' "$DESTINO" "$(du -h "$DESTINO" | awk '{ print $1 }')"
printf 'Se o container estava parado: docker start %s\n' "$CONTAINER"
