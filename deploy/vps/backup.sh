#!/usr/bin/env bash
#
# Backup diário do MEU BLING na VPS: banco SQLite + arquivos (XMLs, DANFEs, anexos, sessão do WhatsApp) + segredos.
# Gera /root/backups/meu-bling/meu-bling-AAAA-MM-DD.tgz e apaga os com mais de 14 dias.
# O instalar-vps.sh agenda este script no cron (03:00). Para rodar na mão: bash /opt/meu-bling/deploy/vps/backup.sh
# Restaurar: parar o container, extrair data/ e storage/ em /var/lib/meu-bling e o .env em /etc, subir de novo.
#
set -euo pipefail

DADOS="${DADOS:-/var/lib/meu-bling}"
ENV_FILE="${ENV_FILE:-/etc/meu-bling.env}"
DESTINO="${DESTINO:-/root/backups/meu-bling}"
DIAS="${DIAS:-14}"

mkdir -p "$DESTINO"
ARQ="$DESTINO/meu-bling-$(date +%F).tgz"

# snapshot do banco (arquivo principal + WAL, se houver) para o tar não pegar o SQLite no meio de uma escrita
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/data"
cp "$DADOS"/data/meubling.db* "$TMP/data/" 2>/dev/null || true

tar czf "$ARQ" \
  -C "$TMP" data \
  -C "$DADOS" storage \
  -C "$(dirname "$ENV_FILE")" "$(basename "$ENV_FILE")"

find "$DESTINO" -name 'meu-bling-*.tgz' -mtime +"$DIAS" -delete
echo "backup: $ARQ ($(du -h "$ARQ" | cut -f1))"
