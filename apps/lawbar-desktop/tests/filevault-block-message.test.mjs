// Tests for the FileVault blocking dialog's wording.
//
// Wording is not usually worth pinning. This is, for two reasons specific to it.
//
// It is the message that stands between a litigator and their case file, and the ONLY guidance
// they get at that moment. On 2026-08-24 its predecessor read, in full: "lawbar requires FileVault
// to be enabled before launch in production mode. Detected state: off. Enable FileVault in System
// Settings …, or set LAWBAR_MODE=dev for development builds."
//
// Two defects there. It was in English, alone among the main-process refusals — every message in
// startupFailure.ts is zh-CN, for a UI whose locale is fixed at zh-CN. And its second sentence
// offered `LAWBAR_MODE=dev` as an apparently co-equal remedy, handing a hurried reader a one-line
// bypass of the control that protects client confidentiality.
//
// Both are the kind of defect a passing test suite never notices, which is why they are asserted.

import test from "node:test";
import assert from "node:assert/strict";

import { fileVaultBlockMessage } from "../dist/src/security/fileVaultProbe.js";

const CJK = /[一-鿿]/;

test("the message is zh-CN, like every other main-process refusal", () => {
  for (const state of ["off", "unknown"]) {
    const { title, detail } = fileVaultBlockMessage(state);
    assert.match(title, CJK, `title for state=${state} is not zh-CN`);
    assert.match(detail, CJK, `detail for state=${state} is not zh-CN`);
  }
});

// The core regression. The safe path must lead, and the bypass must not read as an alternative.
test("the bypass is named development-only and is NOT offered as a remedy", () => {
  const { detail } = fileVaultBlockMessage("off");
  assert.ok(detail.includes("LAWBAR_MODE=dev"), "the flag is still documented, deliberately");
  assert.ok(
    detail.includes("仅供开发调试") && detail.includes("切勿在处理真实当事人材料时使用"),
    "dev mode must be marked development-only and explicitly unsuitable for client material",
  );
  // The predecessor's construction: "Enable FileVault …, OR set LAWBAR_MODE=dev".
  assert.equal(
    /或\s*(将|设置)?\s*LAWBAR_MODE/.test(detail), false,
    "dev mode is presented as an alternative remedy again",
  );
  assert.ok(
    detail.indexOf("系统设置") < detail.indexOf("LAWBAR_MODE"),
    "the safe path must appear before the bypass",
  );
});

// A reader who knows Apple Silicon encrypts at rest will otherwise conclude the block is pedantic
// and reach for dev mode. The message has to answer that, or it loses the argument.
test("it explains why an already-encrypted disk still needs FileVault", () => {
  const { detail } = fileVaultBlockMessage("off");
  assert.ok(detail.includes("已由硬件加密"), "must acknowledge the disk is already encrypted");
  assert.ok(
    detail.includes("并未与您的登录密码绑定"),
    "must say what is actually missing: the key is not bound to a user secret",
  );
  assert.ok(detail.includes("开机即自动解锁"), "must give the concrete consequence");
});

// This app also ships an x64 build, and an older Intel Mac without a T2 has no at-rest encryption.
// Asserting it unconditionally would be a false claim about the user's hardware.
test("the hardware-encryption claim is CONDITIONAL, never asserted of this machine", () => {
  const { detail } = fileVaultBlockMessage("off");
  const i = detail.indexOf("已由硬件加密");
  assert.ok(i > 0);
  assert.match(
    detail.slice(Math.max(0, i - 40), i), /若本机为/,
    "the claim must be conditioned on the hardware, not stated as fact",
  );
});

// Losing the recovery key loses the data. Omitting that would make the instruction dangerous.
test("it warns about the recovery key", () => {
  const { detail } = fileVaultBlockMessage("off");
  assert.ok(detail.includes("恢复密钥"), "enabling FileVault without this warning is unsafe advice");
});

// `unknown` means the probe could not prove FileVault is on — a different claim from "it is off",
// and the message must not assert the stronger one.
test("an indeterminate probe says so, rather than claiming FileVault is off", () => {
  const off = fileVaultBlockMessage("off");
  const unknown = fileVaultBlockMessage("unknown");
  assert.notEqual(unknown.title, off.title, "an unproven state must not be reported as a known one");
  assert.ok(unknown.title.includes("无法确认"));
  assert.ok(unknown.detail.includes("按未开启处理"), "it must still say it is failing closed");
});

test("a probe error is surfaced when present, and absent otherwise", () => {
  assert.ok(!fileVaultBlockMessage("off").detail.includes("检测错误"));
  const withErr = fileVaultBlockMessage("unknown", "fdesetup failed: ENOENT");
  assert.ok(withErr.detail.includes("检测错误：fdesetup failed: ENOENT"));
});

test("the detected state is always reported verbatim", () => {
  for (const state of ["off", "unknown"]) {
    assert.ok(fileVaultBlockMessage(state).detail.includes(`检测到的状态：${state}`));
  }
});
