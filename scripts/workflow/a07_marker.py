#!/usr/bin/env python3
"""a07_marker.py — A0.7 marker write + provenance validation core (WI-ENA11).

Implements ADR A07-MARK-00 for LOCAL-ONLY (gitignored) markers under dev-memo/run/evidence/**:
a marker is durable evidence of a real A0.7 harness PASS, bound to the exact fixture/oracle/harness/
result/command/offline context, made tamper-evident by an HMAC over a CANONICAL payload (NOT a
self-hash of the marker file — anti-circularity), and made non-replayable by a guard-owned ledger
that binds runId -> {markerPath, provenancePayloadHash, repoCommit, repoTreeHash}.

Key custody (M0): the HMAC key is ENV-supplied via LAWBAR_A07_MARKER_HMAC_KEY (>= 32 chars). No key
is committed, generated long-lived, or fetched from cloud/keychain/network. Tests pass an ephemeral
key via the env. Missing/empty/weak key => fail closed (write refuses; validate rejects).

Subcommands:
  write    --fixture P --oracle P --status S --classification C --page-count N --tolerance T
           --command CMD --platform PLAT --out-root DIR --repo-commit SHA --repo-tree SHA
           --harness-commit SHA [--run-id HEX] [--produced-at TS]
           -> writes <out-root>/a07/<repoCommit>.marker.json + appends <out-root>/ledger.jsonl.
              Refuses unless status=pass AND classification=ok AND key is valid. Prints marker path.
  validate --marker P --ledger P
           -> exit 0 iff the marker is provenance-valid + ledger-bound; non-zero otherwise.

This module is the single source of truth for the canonical serialization so writer and validator
agree byte-for-byte. It performs NO network I/O and writes nothing outside the given --out-root.
"""
import argparse, hashlib, hmac, json, os, re, sys

HEXTOKEN = re.compile(r"\A[0-9a-fA-F]{7,64}\Z")  # git-sha-like; used for the path-bearing repo-commit

KEY_ENV = "LAWBAR_A07_MARKER_HMAC_KEY"
MIN_KEY_LEN = 32
SCHEMA_VERSION = "a07-marker/1.0.0"
GATE_ID = "A07-GATE-00"

# Fixed canonical field order (ADR A07-MARK-00 §2; review-064 clarification 1). The HMAC + the
# provenancePayloadHash are computed over EXACTLY this ordered, minimally-separated JSON string.
PAYLOAD_FIELDS = [
    "gateId", "schemaVersion", "harnessImplCommit", "repoCommit", "repoTreeHash",
    "fixturePath", "fixtureSha256", "oraclePath", "oracleSha256",
    "resultStatus", "resultClassification", "observedPageCount", "tolerance",
    "command", "platform", "producedAt", "runId",
    # isMarker is HMAC-bound (WI-ENA11-FIX1): editing it from true -> false changes the canonical
    # payload, breaking provenancePayloadHash + the HMAC, and is also rejected by an explicit check.
    "isMarker",
]


def _key_or_die():
    key = os.environ.get(KEY_ENV, "")
    if len(key) < MIN_KEY_LEN:
        sys.stderr.write(
            f"a07_marker: {KEY_ENV} missing/empty/too-weak (need >= {MIN_KEY_LEN} chars); fail-closed.\n")
        sys.exit(3)
    return key


def _sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _canonical(payload):
    # Deterministic, minimally-separated, ASCII JSON in the fixed field order.
    ordered = {k: payload[k] for k in PAYLOAD_FIELDS}
    return json.dumps(ordered, separators=(",", ":"), ensure_ascii=True)


def _payload_hash(canonical):
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _hmac_hex(key, canonical):
    return hmac.new(key.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def cmd_write(a):
    key = _key_or_die()
    # Eligibility (ADR A07-MARK-00 §7): only pass+ok is marker-eligible. Defense-in-depth in the core.
    if a.status != "pass" or a.classification != "ok":
        sys.stderr.write(
            f"a07_marker: not marker-eligible (status={a.status}, classification={a.classification}); "
            "only pass+ok may produce a marker.\n")
        sys.exit(4)
    for label, p in (("fixture", a.fixture), ("oracle", a.oracle)):
        if not os.path.isfile(p):
            sys.stderr.write(f"a07_marker: {label} not found at {p}\n"); sys.exit(5)
    # repo_commit is the ONLY value interpolated into the marker filename; require a strict hex token
    # so it can never carry a path traversal (e.g. "../..") that escapes --out-root.
    if not HEXTOKEN.match(a.repo_commit or ""):
        sys.stderr.write("a07_marker: --repo-commit must be a hex commit token [0-9a-f]{7,64}\n"); sys.exit(5)
    run_id = a.run_id or os.urandom(16).hex()  # not derivable from the bound artifacts (anti-replay handle)
    payload = {
        "gateId": GATE_ID,
        "schemaVersion": SCHEMA_VERSION,
        "harnessImplCommit": a.harness_commit,
        "repoCommit": a.repo_commit,
        "repoTreeHash": a.repo_tree,
        "fixturePath": a.fixture,
        "fixtureSha256": _sha256_file(a.fixture),
        "oraclePath": a.oracle,
        "oracleSha256": _sha256_file(a.oracle),
        "resultStatus": a.status,
        "resultClassification": a.classification,
        "observedPageCount": int(a.page_count),
        "tolerance": a.tolerance,
        "command": a.command,
        "platform": a.platform,
        "producedAt": a.produced_at,
        "runId": run_id,
        "isMarker": True,  # HMAC-bound (in PAYLOAD_FIELDS); tamper-evident
    }
    canonical = _canonical(payload)
    pph = _payload_hash(canonical)
    prov = _hmac_hex(key, canonical)
    marker = dict(payload)
    marker["provenancePayloadHash"] = pph
    marker["provenance"] = prov

    out_root = a.out_root
    marker_dir = os.path.join(out_root, "a07")
    os.makedirs(marker_dir, exist_ok=True)
    marker_path = os.path.join(marker_dir, f"{a.repo_commit}.marker.json")
    # Defense-in-depth: the resolved marker path MUST stay under realpath(out_root)/a07.
    real_dir = os.path.realpath(marker_dir)
    if os.path.realpath(os.path.dirname(marker_path)) != real_dir:
        sys.stderr.write("a07_marker: refusing marker path outside --out-root/a07\n"); sys.exit(5)
    with open(marker_path, "w", encoding="utf-8") as f:
        json.dump(marker, f, indent=2, sort_keys=True)
        f.write("\n")
    # Guard-owned ledger (outside the marker file): bind runId -> marker identity (anti-replay).
    ledger_path = os.path.join(out_root, "ledger.jsonl")
    entry = {"runId": run_id, "markerPath": marker_path, "provenancePayloadHash": pph,
             "repoCommit": a.repo_commit, "repoTreeHash": a.repo_tree}
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=True) + "\n")
    print(marker_path)
    return 0


def _reject(msg):
    sys.stderr.write(f"a07_marker: INVALID — {msg}\n"); return 6


def cmd_validate(a):
    key = os.environ.get(KEY_ENV, "")
    if len(key) < MIN_KEY_LEN:
        return _reject(f"{KEY_ENV} missing/too-weak; cannot verify (fail-closed)")
    try:
        with open(a.marker, "r", encoding="utf-8") as f:
            m = json.load(f)
    except Exception as e:
        return _reject(f"marker unreadable/not JSON: {e}")
    # All payload fields + provenance fields must be present (schema gate — necessary, not sufficient).
    for k in PAYLOAD_FIELDS + ["provenancePayloadHash", "provenance"]:
        if k not in m:
            return _reject(f"missing field {k}")
    if m.get("gateId") != GATE_ID:
        return _reject(f"unexpected gateId {m.get('gateId')}")
    # isMarker must be the boolean true (not "true"/1). A genuine marker writes True; a flipped
    # isMarker: true -> false also breaks the HMAC below, but this explicit check rejects it up front
    # and ensures an isMarker=false object can never satisfy marker validity (WI-ENA11-FIX1).
    if m.get("isMarker") is not True:
        return _reject("isMarker must be boolean true")
    if m.get("resultStatus") != "pass" or m.get("resultClassification") != "ok":
        return _reject("not marker-eligible (resultStatus/classification != pass/ok)")
    # Reconstruct the EXACT canonical payload from the stored fields and recompute hash + HMAC.
    payload = {k: m[k] for k in PAYLOAD_FIELDS}
    canonical = _canonical(payload)
    if _payload_hash(canonical) != m["provenancePayloadHash"]:
        return _reject("provenancePayloadHash mismatch (tampered/edited payload)")
    expected_prov = _hmac_hex(key, canonical)
    if not hmac.compare_digest(expected_prov, str(m["provenance"])):
        return _reject("HMAC provenance mismatch (forged/wrong-key/edited)")
    # Re-read the bound artifacts: their bytes must still match the recorded hashes.
    for label, pth, want in (("fixture", m["fixturePath"], m["fixtureSha256"]),
                             ("oracle", m["oraclePath"], m["oracleSha256"])):
        if not os.path.isfile(pth):
            return _reject(f"bound {label} missing at {pth}")
        if _sha256_file(pth) != want:
            return _reject(f"bound {label} bytes changed (sha mismatch)")
    # Ledger-bound non-replay: EXACTLY ONE ledger entry must match runId, and it must bind THIS marker
    # identity (path + payload hash + repo/tree). Zero or >1 (duplicate/ambiguous) => reject.
    if not os.path.isfile(a.ledger):
        return _reject("guard ledger missing; cannot confirm non-replay")
    matches = []
    with open(a.ledger, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("runId") == m["runId"]:
                matches.append(e)
    if len(matches) != 1:
        return _reject(f"ledger has {len(matches)} entries for runId (need exactly 1; non-replay)")
    e = matches[0]
    if (os.path.abspath(e.get("markerPath", "")) != os.path.abspath(a.marker)
            or e.get("provenancePayloadHash") != m["provenancePayloadHash"]
            or e.get("repoCommit") != m["repoCommit"]
            or e.get("repoTreeHash") != m["repoTreeHash"]):
        return _reject("ledger entry does not bind this marker (copied/relocated/replayed)")
    print("a07_marker: VALID")
    return 0


def main():
    p = argparse.ArgumentParser(prog="a07_marker.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write")
    for opt in ("fixture", "oracle", "status", "classification", "page-count", "tolerance",
                "command", "platform", "out-root", "repo-commit", "repo-tree", "harness-commit"):
        w.add_argument("--" + opt, required=True)
    w.add_argument("--run-id", default="")
    w.add_argument("--produced-at", default="")
    w.set_defaults(func=cmd_write)
    v = sub.add_parser("validate")
    v.add_argument("--marker", required=True)
    v.add_argument("--ledger", required=True)
    v.set_defaults(func=cmd_validate)
    args = p.parse_args()  # argparse maps --page-count -> args.page_count, etc.
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
