#!/usr/bin/env bash
# A throwaway CA and a certificate for the Sanity stand-in (S5 wave 8, K11), made
# fresh on each CI run and never committed. Only the canary-local job's server
# trusts the CA, through NODE_EXTRA_CA_CERTS.
#
#   bash scripts/canary/sanity-stub-cert.sh <dir> <hostname>
#
# Writes <dir>/ca.pem, <dir>/stub.pem and <dir>/stub-key.pem. The keys stay in <dir>.
set -euo pipefail
dir="$1"
host="$2"
mkdir -p "$dir"
cd "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=canary-ci stand-in CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" \
  -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=$host" -keyout stub-key.pem -out stub.csr 2>/dev/null
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$host" > ext.cnf
openssl x509 -req -in stub.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 2 -extfile ext.cnf -out stub.pem 2>/dev/null
rm -f stub.csr ext.cnf ca-key.pem ca.srl
echo "Stand-in certificate for $host written."
