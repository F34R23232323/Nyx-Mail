#!/usr/bin/env bash
# Generates the local release keystore used to sign NyxMail APKs.
# Keep credentials/ backed up: Android updates require the same signing key.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p credentials
if [[ -f credentials/nyxmail-release.keystore && -f credentials/keystore.properties ]]; then
  echo "Release keystore already exists in credentials/."
  exit 0
fi

PASS="${NYX_KEYSTORE_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
keytool -genkeypair \
  -storetype PKCS12 \
  -keystore credentials/nyxmail-release.keystore \
  -alias nyxmail \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storepass "$PASS" \
  -keypass "$PASS" \
  -dname "CN=NyxMail Mobile, OU=Mobile, O=NyxMail, L=Paris, C=FR"

printf "storeFile=../credentials/nyxmail-release.keystore\nstorePassword=%s\nkeyAlias=nyxmail\nkeyPassword=%s\n" \
  "$PASS" "$PASS" > credentials/keystore.properties
chmod 600 credentials/keystore.properties
echo "Created credentials/nyxmail-release.keystore"
echo "Store the password somewhere safe. It cannot be recovered."
