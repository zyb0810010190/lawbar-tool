#!/usr/bin/env python3
"""a07_marker.py — A0.7 marker write + provenance validation core (WI-ENA11; WI-A07-MARKER-BIND).

Implements ADR A07-MARK-00 for LOCAL-ONLY (gitignored) markers under dev-memo/run/evidence/**:
a marker is durable evidence of a real A0.7 harness PASS, bound to the exact fixture/oracle/harness/
result/command/offline context, made tamper-evident by an HMAC over a CANONICAL payload (NOT a
self-hash of the marker file — anti-circularity), and made non-replayable by a guard-owned ledger
that binds runId -> {markerPath, provenancePayloadHash, repoCommit, repoTreeHash}.

Harness attestation (WI-A07-MARKER-BIND). There is NO caller-asserted verdict path. `write` takes
the harness's EXACT stdout bytes (a file) plus the harness's exit code and the binary that produced
them, and DERIVES status/classification/observedPageCount from those bytes. Everything it attests to
is inside the HMAC-bound payload: the stdout bytes (verbatim + sha256), the harness binary sha256,
the fixture/oracle sha256 (computed here, never accepted from the caller), the oracle's tolerance
(read from the oracle), and the repo commit/tree. `validate` re-derives the verdict from the recorded
stdout and re-hashes the bound fixture/oracle/harness on disk, so a marker cannot silently outlive
the inputs or the binary it attests to, and a re-signed marker whose verdict disagrees with its own
recorded harness output is rejected.

What this does NOT achieve: it is not unforgeable. Anything that can run the harness and read the key
runs as the same uid as this script and can therefore produce a marker. The goal here is narrower and
achievable locally — the marker records WHAT WAS ACTUALLY RUN, so a marker that did not come from a
real harness invocation is DETECTABLE (its recorded binary/stdout/input hashes can be compared with
the real artifacts). Making production unforgeable requires a producer boundary outside the agent's
uid (CI), which is out of scope here.

Key custody (M0): the HMAC key is ENV-supplied via LAWBAR_A07_MARKER_HMAC_KEY (>= 32 chars). No key
is committed, generated long-lived, or fetched from cloud/keychain/network. Tests pass an ephemeral
key via the env. Missing/empty/weak key => fail closed (write refuses; validate rejects).

Subcommands:
  write    --fixture P --oracle P --harness-bin P --harness-stdout P --harness-exit N
           --command CMD --platform PLAT --out-root DIR --repo-commit SHA --repo-tree SHA
           --harness-commit SHA [--run-id HEX] [--produced-at TS]
           -> writes <out-root>/a07/<repoCommit>.marker.json + appends <out-root>/ledger.jsonl.
              Refuses unless the harness's own output says pass+ok, its exit code agrees, and the
              key is valid. Prints the marker path.
  validate --marker P --ledger P
           -> exit 0 iff the marker is provenance-valid + attestation-consistent + ledger-bound.

This module is the single source of truth for the canonical serialization so writer and validator
agree byte-for-byte. It performs NO network I/O, executes nothing, and writes nothing outside the
given --out-root.
"""
import argparse, base64, hashlib, hmac, json, os, re, sys

HEXTOKEN = re.compile(r"\A[0-9a-fA-F]{7,64}\Z")  # git-sha-like; used for the path-bearing repo-commit
PAGECOUNT = re.compile(r"\A(0|[1-9][0-9]{0,8})\Z")  # the harness prints a plain non-negative integer

KEY_ENV = "LAWBAR_A07_MARKER_HMAC_KEY"
MIN_KEY_LEN = 32
SCHEMA_VERSION = "a07-marker/2.0.0"  # 2.0.0 = harness-attestation-bound (WI-A07-MARKER-BIND)
GATE_ID = "A07-GATE-00"

# Exit codes (stable; the writer entrypoint and the tests depend on them).
EX_KEY_OR_TOOL = 3   # missing/weak key, or a broken/unavailable hashing/JSON toolchain
EX_NOT_ELIGIBLE = 4  # the harness's own verdict is not pass+ok
EX_BAD_INPUT = 5     # missing fixture/oracle, malformed oracle, bad repo-commit token
EX_INVALID = 6       # validate: rejected
EX_ATTESTATION = 7   # unusable/incoherent harness attestation (stdout, exit code, binary)

# The harness's own vocabulary (native/evidence-core-swift A07ConformanceStatus / A07Classification).
# An out-of-vocabulary token is fail-closed, never coerced: a marker must speak the harness's language.
HARNESS_STATUSES = {"pass", "fail", "inconclusive"}
HARNESS_CLASSIFICATIONS = {
    "ok",
    "class_1_normalization_math_bug",
    "class_2_geometry_source_instability",
    "fixture_or_oracle_invalid",
    "not_implemented",
    "inconclusive_no_checkable_assertions",
}

SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

# Fixed canonical field order (ADR A07-MARK-00 §2; review-064 clarification 1). The HMAC + the
# provenancePayloadHash are computed over EXACTLY this ordered, minimally-separated JSON string.
PAYLOAD_FIELDS = [
    "gateId", "schemaVersion", "harnessImplCommit", "repoCommit", "repoTreeHash",
    "fixturePath", "fixtureSha256", "oraclePath", "oracleSha256",
    # Harness attestation (WI-A07-MARKER-BIND): the binary that ran, its exact stdout bytes, and the
    # exit code it returned. The verdict fields below are DERIVED from harnessStdoutBase64 and are
    # re-derived at validate time, so they can never disagree with the output they claim to summarize.
    "harnessBinaryPath", "harnessBinarySha256",
    "harnessStdoutBase64", "harnessStdoutSha256", "harnessExitCode",
    "resultStatus", "resultClassification", "observedPageCount", "tolerance",
    "command", "platform", "producedAt", "runId",
    # isMarker is HMAC-bound (WI-ENA11-FIX1): editing it from true -> false changes the canonical
    # payload, breaking provenancePayloadHash + the HMAC, and is also rejected by an explicit check.
    "isMarker",
]


def _die(code, msg):
    sys.stderr.write(f"a07_marker: {msg}\n")
    sys.exit(code)


def _require_tools_or_die():
    """Fail closed if the hashing/JSON toolchain is unavailable or wrong.

    Signing or verifying with a broken primitive would silently produce provenance that means
    nothing, so the primitives are self-tested against known vectors before any marker is written
    or accepted."""
    try:
        if hashlib.sha256(b"abc").hexdigest() != SHA256_OF_ABC:
            raise ValueError("sha256 self-test vector mismatch")
        a = hmac.new(b"x" * MIN_KEY_LEN, b"abc", hashlib.sha256).hexdigest()
        b = hmac.new(b"y" * MIN_KEY_LEN, b"abc", hashlib.sha256).hexdigest()
        if len(a) != 64 or a == b:
            raise ValueError("hmac self-test failed")
        if json.loads(json.dumps({"a": [1, "b"]})) != {"a": [1, "b"]}:
            raise ValueError("json self-test failed")
        if base64.b64decode(base64.b64encode(b"\x00\xffab")) != b"\x00\xffab":
            raise ValueError("base64 self-test failed")
    except Exception as e:  # includes an absent/shadowed hashlib/hmac/json/base64
        _die(EX_KEY_OR_TOOL, f"hashing/JSON toolchain unavailable or wrong ({e}); fail-closed.")


def _key_or_die():
    key = os.environ.get(KEY_ENV, "")
    if len(key) < MIN_KEY_LEN:
        _die(EX_KEY_OR_TOOL,
             f"{KEY_ENV} missing/empty/too-weak (need >= {MIN_KEY_LEN} chars); fail-closed.")
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


def _parse_harness_stdout(raw):
    """Parse the harness's EXACT stdout bytes -> (status, classification, observedPageCount).

    Contract (native/evidence-core-swift Sources/A07HarnessCLI/main.swift): ONE line,
    "<status>\\t<classification>\\t<observedPageCount>". Returns None on ANY deviation — a verdict
    that cannot be read unambiguously out of the harness's own bytes is a failure, never a guess."""
    if not raw:
        return None
    try:
        text = raw.decode("utf-8")
    except Exception:
        return None
    if text.endswith("\n"):
        text = text[:-1]
    if "\n" in text or "\r" in text:
        return None
    parts = text.split("\t")
    if len(parts) != 3:
        return None
    status, classification, pages = parts
    if status not in HARNESS_STATUSES or classification not in HARNESS_CLASSIFICATIONS:
        return None
    if not PAGECOUNT.match(pages):
        return None
    return status, classification, int(pages)


def _oracle_tolerance(path):
    """Read the tolerance the harness was measured against FROM the oracle (never from the caller)."""
    with open(path, "r", encoding="utf-8") as f:
        oracle = json.load(f)
    tol = oracle["tolerance"]["absolutePdfPoints"]
    if isinstance(tol, bool) or not isinstance(tol, (int, float)) or tol < 0:
        raise ValueError("tolerance.absolutePdfPoints must be a non-negative number")
    return float(tol)


def cmd_write(a):
    _require_tools_or_die()
    key = _key_or_die()

    # --- Harness attestation ------------------------------------------------------------------
    # The verdict is DERIVED from the harness's own captured stdout bytes. There is no
    # --status/--classification path: a caller cannot assert a gate result (WI-A07-MARKER-BIND, S5).
    if not os.path.isfile(a.harness_stdout):
        _die(EX_ATTESTATION, f"--harness-stdout is not a readable file: {a.harness_stdout}")
    try:
        with open(a.harness_stdout, "rb") as f:
            raw_stdout = f.read()
    except OSError as e:
        _die(EX_ATTESTATION, f"--harness-stdout unreadable: {e}")
    parsed = _parse_harness_stdout(raw_stdout)
    if parsed is None:
        _die(EX_ATTESTATION,
             "harness stdout does not match the harness output contract "
             "(exactly one '<status>\\t<classification>\\t<pageCount>' line in the harness vocabulary)")
    status, classification, page_count = parsed
    try:
        exit_code = int(a.harness_exit)
    except (TypeError, ValueError):
        _die(EX_ATTESTATION, f"--harness-exit must be an integer, got {a.harness_exit!r}")
    # The harness exits 0 iff status == pass. A disagreement means the captured result and the
    # captured process outcome describe different runs — refuse rather than pick one.
    if (exit_code == 0) != (status == "pass"):
        _die(EX_ATTESTATION,
             f"harness exit code {exit_code} is inconsistent with the reported status '{status}' "
             "(the harness exits 0 iff status == pass)")
    if not os.path.isfile(a.harness_bin) or not os.access(a.harness_bin, os.X_OK):
        _die(EX_ATTESTATION, f"--harness-bin is not an executable file: {a.harness_bin}")

    # --- Eligibility (ADR A07-MARK-00 §7) -----------------------------------------------------
    # Only pass+ok is marker-eligible. inconclusive / not_implemented are FAILURES, never a pass
    # (.claude/rules/evidence-genie.md inv.10).
    if status != "pass" or classification != "ok":
        _die(EX_NOT_ELIGIBLE,
             f"harness verdict not marker-eligible (status={status}, classification={classification}); "
             "only pass+ok may produce a marker.")

    for label, p in (("fixture", a.fixture), ("oracle", a.oracle)):
        if not os.path.isfile(p):
            _die(EX_BAD_INPUT, f"{label} not found at {p}")
    # repo_commit is the ONLY value interpolated into the marker filename; require a strict hex token
    # so it can never carry a path traversal (e.g. "../..") that escapes --out-root.
    if not HEXTOKEN.match(a.repo_commit or ""):
        _die(EX_BAD_INPUT, "--repo-commit must be a hex commit token [0-9a-f]{7,64}")
    try:
        tolerance = _oracle_tolerance(a.oracle)
    except Exception as e:
        _die(EX_BAD_INPUT, f"oracle tolerance unreadable at {a.oracle}: {e}")

    # Absolute paths: a bound artifact must be re-findable at validate time independent of cwd.
    fixture = os.path.abspath(a.fixture)
    oracle = os.path.abspath(a.oracle)
    harness_bin = os.path.abspath(a.harness_bin)

    run_id = a.run_id or os.urandom(16).hex()  # not derivable from the bound artifacts (anti-replay handle)
    payload = {
        "gateId": GATE_ID,
        "schemaVersion": SCHEMA_VERSION,
        "harnessImplCommit": a.harness_commit,
        "repoCommit": a.repo_commit,
        "repoTreeHash": a.repo_tree,
        "fixturePath": fixture,
        "fixtureSha256": _sha256_file(fixture),
        "oraclePath": oracle,
        "oracleSha256": _sha256_file(oracle),
        "harnessBinaryPath": harness_bin,
        "harnessBinarySha256": _sha256_file(harness_bin),
        # Verbatim bytes + their digest: the marker carries the evidence it summarizes, so validate
        # can re-derive the verdict instead of trusting the summary.
        "harnessStdoutBase64": base64.b64encode(raw_stdout).decode("ascii"),
        "harnessStdoutSha256": hashlib.sha256(raw_stdout).hexdigest(),
        "harnessExitCode": exit_code,
        "resultStatus": status,
        "resultClassification": classification,
        "observedPageCount": page_count,
        "tolerance": tolerance,
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
        _die(EX_BAD_INPUT, "refusing marker path outside --out-root/a07")
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
    sys.stderr.write(f"a07_marker: INVALID — {msg}\n"); return EX_INVALID


def cmd_validate(a):
    _require_tools_or_die()
    key = os.environ.get(KEY_ENV, "")
    if len(key) < MIN_KEY_LEN:
        return _reject(f"{KEY_ENV} missing/too-weak; cannot verify (fail-closed)")
    try:
        with open(a.marker, "r", encoding="utf-8") as f:
            m = json.load(f)
    except Exception as e:
        return _reject(f"marker unreadable/not JSON: {e}")
    if not isinstance(m, dict):
        return _reject("marker is not a JSON object")
    if m.get("gateId") != GATE_ID:
        return _reject(f"unexpected gateId {m.get('gateId')}")
    # Schema is pinned: a marker written under an older schema carries no harness attestation, so it
    # cannot prove the gate RAN and is refused rather than grandfathered (WI-A07-MARKER-BIND).
    if m.get("schemaVersion") != SCHEMA_VERSION:
        return _reject(
            f"unsupported schemaVersion {m.get('schemaVersion')!r} (expected {SCHEMA_VERSION}); "
            "re-run the harness via scripts/workflow/a07-marker-write.sh")
    # All payload fields + provenance fields must be present (schema gate — necessary, not sufficient).
    for k in PAYLOAD_FIELDS + ["provenancePayloadHash", "provenance"]:
        if k not in m:
            return _reject(f"missing field {k}")
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

    # --- Re-derive the verdict from the RECORDED harness output --------------------------------
    # The HMAC only proves the payload was not edited. These checks prove the payload is internally
    # coherent: the verdict must be exactly what the recorded harness bytes say, and the recorded
    # process outcome must agree. A marker re-signed with a held key still fails here unless the
    # harness output it carries actually says pass+ok.
    if not isinstance(m["observedPageCount"], int) or isinstance(m["observedPageCount"], bool):
        return _reject("observedPageCount must be an integer")
    if not isinstance(m["harnessExitCode"], int) or isinstance(m["harnessExitCode"], bool):
        return _reject("harnessExitCode must be an integer")
    try:
        raw_stdout = base64.b64decode(str(m["harnessStdoutBase64"]).encode("ascii"), validate=True)
    except Exception as e:
        return _reject(f"harnessStdoutBase64 is not valid base64: {e}")
    if hashlib.sha256(raw_stdout).hexdigest() != m["harnessStdoutSha256"]:
        return _reject("harnessStdoutSha256 does not match the recorded harness stdout bytes")
    parsed = _parse_harness_stdout(raw_stdout)
    if parsed is None:
        return _reject("recorded harness stdout does not match the harness output contract")
    if parsed != (m["resultStatus"], m["resultClassification"], m["observedPageCount"]):
        return _reject("recorded verdict does not match the recorded harness stdout (desynced/forged)")
    if m["harnessExitCode"] != 0:
        return _reject("recorded harness exit code is not 0 (a marker-eligible run exits 0)")

    # Re-read the bound artifacts: their bytes must still match the recorded hashes. A marker may not
    # silently outlive the fixture/oracle it attests to, nor be replayed across a rebuilt harness.
    for label, pth, want in (("fixture", m["fixturePath"], m["fixtureSha256"]),
                             ("oracle", m["oraclePath"], m["oracleSha256"]),
                             ("harness binary", m["harnessBinaryPath"], m["harnessBinarySha256"])):
        if not isinstance(pth, str) or not os.path.isfile(pth):
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
    # NOTE: there is deliberately no --status / --classification / --page-count / --tolerance. The
    # verdict, the page count, and the tolerance are derived from the harness output and the oracle.
    for opt in ("fixture", "oracle", "harness-bin", "harness-stdout", "harness-exit",
                "command", "platform", "out-root", "repo-commit", "repo-tree", "harness-commit"):
        w.add_argument("--" + opt, required=True)
    w.add_argument("--run-id", default="")
    w.add_argument("--produced-at", default="")
    w.set_defaults(func=cmd_write)
    v = sub.add_parser("validate")
    v.add_argument("--marker", required=True)
    v.add_argument("--ledger", required=True)
    v.set_defaults(func=cmd_validate)
    args = p.parse_args()  # argparse maps --harness-bin -> args.harness_bin, etc.
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
