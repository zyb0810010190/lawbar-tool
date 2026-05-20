# Regenerating WI-03d TLS test fixtures

**Maintenance-only. Tests do NOT run this.**

This memo captures the one-time OpenSSL commands that produced the
fixtures under `services/ocr-worker/tests/fixtures/tls/`. Re-run only
when:

- A leaf cert's `notAfter` is within 12 months of `Date.now()` (the
  fixture self-check test flags the 30-day buffer earlier).
- A new SAN profile is required by a new WI-03d test case.
- Cryptographic-algorithm policy changes.

CI MUST NOT run this script. The test suite uses static checked-in PEMs.

## Prerequisites

- OpenSSL ≥ 3.0 (built against modern policy defaults; ECDSA P-256 supported).
- macOS Homebrew (`/opt/homebrew/bin/openssl`) or Linux distro package.

## Procedure

Run from a temporary work directory; copy the resulting PEMs into
`services/ocr-worker/tests/fixtures/tls/` and delete the work dir.

```bash
# Setup
FIXTURES=/path/to/repo/services/ocr-worker/tests/fixtures/tls
WORK=$(mktemp -d)
cd "$WORK"

# --- Root CA config ---
cat > ca.cnf <<'EOF'
[req]
distinguished_name = req_dn
prompt = no
x509_extensions = v3_ca

[req_dn]
CN = WI-03d Test Root CA

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF

# --- Per-leaf SAN configs ---
cat > server-hostname.cnf <<'EOF'
[req]
distinguished_name = req_dn
prompt = no
req_extensions = v3_req
[req_dn]
CN = allowed-host.test
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = allowed-host.test
EOF

cat > server-ip-only.cnf <<'EOF'
[req]
distinguished_name = req_dn
prompt = no
req_extensions = v3_req
[req_dn]
CN = 127.0.0.1
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
IP.1 = 127.0.0.1
EOF

cat > server-wrong-host.cnf <<'EOF'
[req]
distinguished_name = req_dn
prompt = no
req_extensions = v3_req
[req_dn]
CN = other-host.test
[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = other-host.test
EOF

# --- Root CA: P-256, self-signed, 10 years ---
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ca.key
openssl req -new -x509 -key ca.key -out ca.crt -days 3650 -config ca.cnf

# --- Leaves: P-256, signed by CA, 10 years, deterministic serials ---
echo "01" > serial-server-hostname.txt
echo "02" > serial-server-ip-only.txt
echo "03" > serial-server-wrong-host.txt

for name in server-hostname server-ip-only server-wrong-host; do
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ${name}.key
  openssl req -new -key ${name}.key -out ${name}.csr -config ${name}.cnf
  openssl x509 -req -in ${name}.csr \
    -CA ca.crt -CAkey ca.key \
    -CAserial serial-${name}.txt \
    -out ${name}.crt -days 3650 \
    -extfile ${name}.cnf -extensions v3_req
done

# --- Copy committed-fixture set into the repo ---
cp ca.crt ca.key \
   server-hostname.crt server-hostname.key \
   server-ip-only.crt server-ip-only.key \
   server-wrong-host.crt server-wrong-host.key \
   "$FIXTURES/"

# --- Clean up the work dir ---
cd / && rm -rf "$WORK"
```

## Verification after regeneration

```bash
cd /path/to/repo
node --test services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs
```

The self-check must pass (all 8+ assertions green) before committing.

## Filename map (committed PEMs)

| File | Subject | SAN | Serial |
|------|---------|-----|--------|
| `ca.crt` / `ca.key` | `CN=WI-03d Test Root CA` | n/a | self-signed |
| `server-hostname.crt` / `.key` | `CN=allowed-host.test` | `DNS:allowed-host.test` | 1 |
| `server-ip-only.crt` / `.key` | `CN=127.0.0.1` | `IP:127.0.0.1` | 2 |
| `server-wrong-host.crt` / `.key` | `CN=other-host.test` | `DNS:other-host.test` | 3 |

## TEST-ONLY warning

These keys are committed deliberately. They are not secrets. Do NOT
copy them outside this repo's test fixtures, do NOT reuse them as
credentials elsewhere, and do NOT include them in any production
trust store.
