#!/usr/bin/env bash
# 生成本地 Android release 签名 keystore 与 keystore.properties（不提交 Git）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/src-tauri/gen/android"
KEYSTORE="${KEYSTORE:-$HOME/xml2jianpu-upload.jks}"
ALIAS="${ALIAS:-upload}"
PROPS="$ANDROID_DIR/keystore.properties"

if [[ -f "$KEYSTORE" ]]; then
  echo "Keystore already exists: $KEYSTORE"
else
  echo "Creating keystore at $KEYSTORE (alias: $ALIAS)"
  keytool -genkey -v \
    -keystore "$KEYSTORE" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -alias "$ALIAS"
fi

if [[ -f "$PROPS" ]]; then
  echo "keystore.properties already exists: $PROPS"
  exit 0
fi

read -rsp "Enter keystore password: " PASSWORD
echo
cat > "$PROPS" <<EOF
password=$PASSWORD
keyAlias=$ALIAS
storeFile=$KEYSTORE
EOF
chmod 600 "$PROPS"
echo "Wrote $PROPS"
