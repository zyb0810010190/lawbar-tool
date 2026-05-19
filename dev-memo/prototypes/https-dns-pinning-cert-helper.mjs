// WI-01 cert helper: self-signed CA + three leaf certs for the
// HTTPS DNS-pinning prototype gate (ADR-11D.2-A §"Required sequencing"
// and Consequences §1).
//
// Three leaf certs are generated, each signed by the same self-signed
// CA, with different Subject Alternative Names:
//
//   #1 (hostname): SAN = DNS:<hostname>   -> cert-valid-for-hostname
//   #2 (ip-only):  SAN = IP:127.0.0.1     -> cert-valid-only-for-IP
//   #3 (wrong-host): SAN = DNS:other-host.test
//
// The CA, keys, and certs are written under a callee-supplied temp
// directory so the POC can clean up without touching system trust.
//
// Generation shells out to `openssl` (LibreSSL or OpenSSL >=1.1).
// No new Node dependency.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OPENSSL_BIN = process.env.OPENSSL_BIN ?? "openssl";

function run(args, opts = {}) {
  return execFileSync(OPENSSL_BIN, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });
}

function writeOpensslConfig(path, { commonName, sans }) {
  // Minimal x509 config with v3 extensions for SANs.
  const altSection = sans
    .map((entry, i) => {
      if (entry.startsWith("DNS:")) return `DNS.${i + 1} = ${entry.slice(4)}`;
      if (entry.startsWith("IP:")) return `IP.${i + 1} = ${entry.slice(3)}`;
      throw new Error(`Unsupported SAN entry: ${entry}`);
    })
    .join("\n");
  const cfg = `
[ req ]
distinguished_name = req_distinguished_name
prompt             = no
req_extensions     = v3_req

[ req_distinguished_name ]
CN = ${commonName}

[ v3_req ]
subjectAltName     = @alt_names
keyUsage           = digitalSignature, keyEncipherment
extendedKeyUsage   = serverAuth

[ alt_names ]
${altSection}
`;
  writeFileSync(path, cfg, "utf8");
}

function genKey(keyPath) {
  run(["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyPath]);
}

function genCa(workDir) {
  const caKey = join(workDir, "ca.key.pem");
  const caCert = join(workDir, "ca.cert.pem");
  genKey(caKey);
  run([
    "req",
    "-x509",
    "-new",
    "-nodes",
    "-key",
    caKey,
    "-sha256",
    "-days",
    "1",
    "-subj",
    "/CN=https-dns-pinning-poc-CA",
    "-out",
    caCert,
  ]);
  return { caKey, caCert };
}

function genLeaf(workDir, label, ca, { commonName, sans }) {
  const keyPath = join(workDir, `${label}.key.pem`);
  const csrPath = join(workDir, `${label}.csr.pem`);
  const cfgPath = join(workDir, `${label}.cnf`);
  const certPath = join(workDir, `${label}.cert.pem`);
  genKey(keyPath);
  writeOpensslConfig(cfgPath, { commonName, sans });
  run([
    "req",
    "-new",
    "-key",
    keyPath,
    "-out",
    csrPath,
    "-config",
    cfgPath,
  ]);
  run([
    "x509",
    "-req",
    "-in",
    csrPath,
    "-CA",
    ca.caCert,
    "-CAkey",
    ca.caKey,
    "-CAcreateserial",
    "-out",
    certPath,
    "-days",
    "1",
    "-sha256",
    "-extfile",
    cfgPath,
    "-extensions",
    "v3_req",
  ]);
  return { keyPath, certPath, cfgPath, csrPath };
}

/**
 * Generate the CA + three leaf certs.
 *
 * @param {object} opts
 * @param {string} opts.workDir   Existing directory to write files into.
 * @param {string} opts.hostname  The hostname to bind cert #1 to (e.g. "allowed-host.test").
 * @returns {{ ca, certHostname, certIpOnly, certWrongHost }}
 */
export function generateCertSuite({ workDir, hostname }) {
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const ca = genCa(workDir);
  const certHostname = genLeaf(workDir, "leaf-hostname", ca, {
    commonName: hostname,
    sans: [`DNS:${hostname}`],
  });
  const certIpOnly = genLeaf(workDir, "leaf-iponly", ca, {
    commonName: "127.0.0.1",
    sans: ["IP:127.0.0.1"],
  });
  const certWrongHost = genLeaf(workDir, "leaf-wronghost", ca, {
    commonName: "other-host.test",
    sans: ["DNS:other-host.test"],
  });
  return { ca, certHostname, certIpOnly, certWrongHost };
}
