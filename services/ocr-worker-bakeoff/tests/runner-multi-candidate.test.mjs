// Multi-candidate isolation tests for runBakeoff().
//
// Audit 019e396b H#1: bin/bakeoff.mjs now runs two candidates in a
// single bakeoff invocation. The runner MUST isolate candidates from
// each other: a thrown exception, a typed probe failure, or a thrown
// run() in one candidate must not prevent the other candidate's
// observations from being produced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { runBakeoff } from "../dist/runner.js";

function fixturesRootWith(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-multi-"));
  for (const fx of fixtures) {
    const imgPath = join(dir, fx.path);
    const txtPath = join(dir, fx.expected_text_path);
    writeFileSync(imgPath, fx._imgBytes ?? Buffer.from("stub"));
    writeFileSync(txtPath, fx._txtBytes ?? Buffer.from("stub"));
  }
  return dir;
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeStubFixture(id, dir) {
  const imgBytes = Buffer.from(`img:${id}`);
  const txtBytes = Buffer.from(`expected:${id}`);
  return {
    active: true,
    id,
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: `${id}.png`,
    expected_text_path: `${id}.txt`,
    sha256: sha(imgBytes),
    expected_text_sha256: sha(txtBytes),
    language: "eng",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "stub",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: `expected:${id}`,
    },
    _imgBytes: imgBytes,
    _txtBytes: txtBytes,
  };
}

function makeSuccessfulCandidate(name) {
  return {
    name,
    version_pinned: "0.0.0",
    license: {
      code_license: "MIT",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() {
      return { status: "available", resolved_version: "0.0.0" };
    },
    async run(fx) {
      return {
        outcome: "success",
        fixture_id: fx.id,
        engine_name: name,
        engine_version: "0.0.0",
        transcript: `expected:${fx.id}`,
        latency_ms: 10,
        peak_rss_bytes: 1000,
        cold_model_load_ms: 5,
        per_page_inference_ms: 5,
        run_kind: "cold",
      };
    },
    async dispose() {},
  };
}

function makeTypedFailureCandidate(name) {
  return {
    name,
    version_pinned: "0.0.0",
    license: {
      code_license: "MIT",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() {
      return {
        status: "missing_dependency",
        dependency: name,
        remediation: `install ${name}`,
      };
    },
    async run() {
      throw new Error("run() should not be called when probe is not available");
    },
    async dispose() {},
  };
}

function makeProbeThrowingCandidate(name) {
  return {
    name,
    version_pinned: "0.0.0",
    license: {
      code_license: "MIT",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() {
      throw new Error("synthetic probe error");
    },
    async run() { throw new Error("unreachable"); },
    async dispose() {},
  };
}

function makeRunThrowingCandidate(name) {
  return {
    name,
    version_pinned: "0.0.0",
    license: {
      code_license: "MIT",
      model_license: null,
      redistribution: "permitted",
      code_evidence_url: "https://example.invalid/code",
      model_evidence_url: null,
      last_verified_at: "2026-01-01",
    },
    supported_run_kinds: ["cold"],
    async probe() {
      return { status: "available", resolved_version: "0.0.0" };
    },
    async run(fx) {
      throw new Error(`synthetic run error on ${fx.id}`);
    },
    async dispose() {},
  };
}

// ---------------------------------------------------------------------------

test("multi-candidate: typed probe failure on δ does NOT block β's runs", async () => {
  const fixtures = [makeStubFixture("fx-1"), makeStubFixture("fx-2")];
  const dir = fixturesRootWith(fixtures);
  const report = await runBakeoff({
    candidates: [makeSuccessfulCandidate("beta"), makeTypedFailureCandidate("delta")],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });

  // Each candidate produced one probe entry.
  assert.equal(report.probes.length, 2);
  const betaProbe = report.probes.find((p) => p.candidate === "beta");
  const deltaProbe = report.probes.find((p) => p.candidate === "delta");
  assert.equal(betaProbe?.result.status, "available");
  assert.equal(deltaProbe?.result.status, "missing_dependency");

  // 2 candidates × 2 fixtures = 4 observations, partitioned by engine_name.
  assert.equal(report.observations.length, 4);
  const betaObs = report.observations.filter((o) => o.engine_name === "beta");
  const deltaObs = report.observations.filter((o) => o.engine_name === "delta");
  assert.equal(betaObs.length, 2);
  assert.equal(deltaObs.length, 2);
  // β succeeded for both fixtures.
  assert.ok(betaObs.every((o) => o.outcome === "success"));
  // δ produced typed probe_missing_dependency failures.
  assert.ok(deltaObs.every((o) => o.outcome === "failure" && o.code === "probe_missing_dependency"));

  // CER computed only for β (success).
  assert.equal(report.cer_scores.length, 2);
  assert.ok(report.cer_scores.every((s) => s.candidate === "beta"));
});

test("multi-candidate: thrown probe in δ becomes structured probe_failed, β still runs", async () => {
  const fixtures = [makeStubFixture("fx-1")];
  const dir = fixturesRootWith(fixtures);
  const report = await runBakeoff({
    candidates: [makeProbeThrowingCandidate("delta"), makeSuccessfulCandidate("beta")],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });

  // δ's thrown probe is wrapped as probe_failed.
  const deltaProbe = report.probes.find((p) => p.candidate === "delta");
  assert.equal(deltaProbe?.result.status, "probe_failed");
  if (deltaProbe?.result.status === "probe_failed") {
    assert.match(deltaProbe.result.error_message, /synthetic probe error/);
  }
  // β still ran successfully despite δ being first in the array.
  const betaObs = report.observations.filter((o) => o.engine_name === "beta");
  assert.equal(betaObs.length, 1);
  assert.equal(betaObs[0].outcome, "success");
});

test("multi-candidate: thrown run() in δ becomes engine_threw observation, other fixtures + β still complete", async () => {
  const fixtures = [makeStubFixture("fx-1"), makeStubFixture("fx-2")];
  const dir = fixturesRootWith(fixtures);
  const report = await runBakeoff({
    candidates: [makeRunThrowingCandidate("delta"), makeSuccessfulCandidate("beta")],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });

  // δ probe was fine; run() throws → engine_threw failure per fixture.
  const deltaObs = report.observations.filter((o) => o.engine_name === "delta");
  assert.equal(deltaObs.length, 2);
  assert.ok(deltaObs.every((o) => o.outcome === "failure" && o.code === "engine_threw"));
  for (const obs of deltaObs) {
    if (obs.outcome === "failure") {
      assert.match(obs.message, /synthetic run error/);
    }
  }

  // β still ran successfully on BOTH fixtures.
  const betaObs = report.observations.filter((o) => o.engine_name === "beta");
  assert.equal(betaObs.length, 2);
  assert.ok(betaObs.every((o) => o.outcome === "success"));

  // CER scores only for β.
  assert.equal(report.cer_scores.length, 2);
  assert.ok(report.cer_scores.every((s) => s.candidate === "beta"));
});

test("multi-candidate: observations partition correctly by engine_name when ordering varies", async () => {
  const fixtures = [makeStubFixture("fx-a")];
  const dir = fixturesRootWith(fixtures);
  // Two successful candidates back-to-back.
  const report = await runBakeoff({
    candidates: [makeSuccessfulCandidate("first"), makeSuccessfulCandidate("second")],
    fixtures,
    roleFilter: "smoke",
    fixturesRoot: dir,
  });
  assert.equal(report.observations.length, 2);
  const names = report.observations.map((o) => o.engine_name).sort();
  assert.deepEqual(names, ["first", "second"]);
  // Same for cer_scores.
  const candidateNames = report.cer_scores.map((s) => s.candidate).sort();
  assert.deepEqual(candidateNames, ["first", "second"]);
});
