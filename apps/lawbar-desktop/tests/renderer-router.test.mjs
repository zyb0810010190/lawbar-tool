// Router unit tests. Pure-Node; no DOM required.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §9.3 + G-UI-5a.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, buildHash } from "../dist/renderer/router.js";

const VALID_ULID = "01jzabcdef0123456789ghjkmn"; // 26 chars Crockford base32 lowercase
const VALID_ULID_2 = "01jzwxyzpq0123456789rstvwx";

test("parseHash: empty hash → list", () => {
  assert.deepEqual(parseHash(""), { name: "list", params: {} });
});

test("parseHash: '#' alone → list", () => {
  assert.deepEqual(parseHash("#"), { name: "list", params: {} });
});

test("parseHash: '#/matters' → list", () => {
  assert.deepEqual(parseHash("#/matters"), { name: "list", params: {} });
});

test("parseHash: '#matters' (no slash) → list", () => {
  assert.deepEqual(parseHash("#matters"), { name: "list", params: {} });
});

test("parseHash: '#/matters/new' → new", () => {
  assert.deepEqual(parseHash("#/matters/new"), { name: "new", params: {} });
});

test("parseHash: '#/matters/:ulid' → view with id param", () => {
  assert.deepEqual(parseHash(`#/matters/${VALID_ULID}`), {
    name: "view",
    params: { id: VALID_ULID },
  });
});

test("parseHash: '#/matters/:ulid/archive' → archive with id param", () => {
  assert.deepEqual(parseHash(`#/matters/${VALID_ULID}/archive`), {
    name: "archive",
    params: { id: VALID_ULID },
  });
});

test("parseHash: malformed id (too short) → not-found", () => {
  assert.deepEqual(parseHash("#/matters/short"), { name: "not-found", params: {} });
});

test("parseHash: malformed id (uppercase) → not-found", () => {
  // ULID regex requires lowercase Crockford base32.
  const upper = VALID_ULID.toUpperCase();
  assert.deepEqual(parseHash(`#/matters/${upper}`), { name: "not-found", params: {} });
});

test("parseHash: malformed id (contains invalid char) → not-found", () => {
  // Use '*' which is not Crockford base32.
  const bad = "01jzabcdef0123456789ghjk*n";
  assert.deepEqual(parseHash(`#/matters/${bad}`), { name: "not-found", params: {} });
});

test("parseHash: archive with malformed id → not-found", () => {
  assert.deepEqual(parseHash("#/matters/short/archive"), { name: "not-found", params: {} });
});

test("parseHash: unknown top-level → not-found", () => {
  assert.deepEqual(parseHash("#/settings"), { name: "not-found", params: {} });
});

test("parseHash: extra segment after archive → not-found", () => {
  assert.deepEqual(parseHash(`#/matters/${VALID_ULID}/archive/extra`), {
    name: "not-found",
    params: {},
  });
});

test("buildHash: list → '#/matters'", () => {
  assert.equal(buildHash("list"), "#/matters");
});

test("buildHash: new → '#/matters/new'", () => {
  assert.equal(buildHash("new"), "#/matters/new");
});

test("buildHash: view → '#/matters/:id'", () => {
  assert.equal(buildHash("view", { id: VALID_ULID }), `#/matters/${VALID_ULID}`);
});

test("buildHash: archive → '#/matters/:id/archive'", () => {
  assert.equal(buildHash("archive", { id: VALID_ULID_2 }), `#/matters/${VALID_ULID_2}/archive`);
});

test("buildHash: view without id throws", () => {
  assert.throws(() => buildHash("view"), /id required/);
});

test("buildHash: archive without id throws", () => {
  assert.throws(() => buildHash("archive"), /id required/);
});

test("buildHash: not-found → '#/not-found' (D7 404 fallback)", () => {
  assert.equal(buildHash("not-found"), "#/not-found");
});

test("round-trip: buildHash(view) → parseHash → name='view' id preserved", () => {
  const hash = buildHash("view", { id: VALID_ULID });
  assert.deepEqual(parseHash(hash), { name: "view", params: { id: VALID_ULID } });
});

test("round-trip: buildHash(archive) → parseHash → name='archive' id preserved", () => {
  const hash = buildHash("archive", { id: VALID_ULID_2 });
  assert.deepEqual(parseHash(hash), { name: "archive", params: { id: VALID_ULID_2 } });
});
