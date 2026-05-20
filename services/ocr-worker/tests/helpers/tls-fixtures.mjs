// WI-03d static TLS fixture loader.
//
// Loads the checked-in PEM fixtures under
// `services/ocr-worker/tests/fixtures/tls/` for use in the local
// HTTPS server lifecycle (`tls-server.mjs`) and the transport / e2e
// assertions. Production code never touches these files.
//
// All fixtures are TEST-ONLY. See
// `services/ocr-worker/tests/fixtures/tls/README.md`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "fixtures", "tls");

function read(name) {
  return readFileSync(join(FIXTURES_DIR, name));
}

/**
 * Load the WI-03d TLS fixture set as raw `Buffer`s ready for
 * `tls.createSecureContext` / `https.createServer` / `https.request`
 * `ca` option. Buffers (not strings) avoid any UTF-8 round-trip on
 * PEM bytes.
 */
export function loadTlsFixtures() {
  return {
    /** TEST-ONLY root CA used to sign every leaf. */
    ca: read("ca.crt"),

    /** Leaf for the hostname-success case (SAN: DNS:allowed-host.test). */
    hostname: {
      key: read("server-hostname.key"),
      cert: read("server-hostname.crt"),
    },
    /** Leaf for the IP-only case (SAN: IP:127.0.0.1 only — no DNS SAN). */
    ipOnly: {
      key: read("server-ip-only.key"),
      cert: read("server-ip-only.crt"),
    },
    /** Leaf for the wrong-hostname case (SAN: DNS:other-host.test). */
    wrongHost: {
      key: read("server-wrong-host.key"),
      cert: read("server-wrong-host.crt"),
    },
  };
}

/** The hostname the success-fixture cert is valid for. */
export const ALLOWED_HOSTNAME = "allowed-host.test";
