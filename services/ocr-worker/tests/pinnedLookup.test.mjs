// Direct unit tests for the pinned-lookup helper used by
// makeNodeHttpsRequestTransport (WI-03a).
//
// This is the one non-skipped behavioral assertion that the
// security-critical `lookup` callback returns ONLY allowedAddresses[0]
// — never the full vetted list — in both Node 22 `options.all === true`
// mode and the legacy single-address mode. The full TLS test harness
// that exercises the transport end-to-end is deferred to WI-03d
// (per docs/release/go-live-plan.md WI-03a boundary disclaimer).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makePinnedLookup } from "../dist/index.js";

const VETTED_FIRST = { address: "8.8.8.8", family: 4 };
const VETTED_SECOND = { address: "1.1.1.1", family: 4 };

test("primary mode (options.all === true): callback receives single-element array containing entry[0]", () => {
  const lookup = makePinnedLookup(VETTED_FIRST);
  let received;
  lookup("ignored-host.example", { all: true }, (err, addressOrList) => {
    received = { err, addressOrList };
  });
  assert.equal(received.err, null);
  assert.ok(Array.isArray(received.addressOrList), "primary mode must deliver an array");
  assert.equal(received.addressOrList.length, 1, "the array must contain exactly one entry — never the full vetted list");
  assert.deepEqual(received.addressOrList[0], { address: "8.8.8.8", family: 4 });
});

test("primary mode with a different pinned address: still only one entry, matching the pinned one", () => {
  const lookup = makePinnedLookup(VETTED_SECOND);
  let received;
  lookup("ignored-host.example", { all: true }, (err, addressOrList) => {
    received = { err, addressOrList };
  });
  assert.deepEqual(received.addressOrList, [{ address: "1.1.1.1", family: 4 }]);
});

test("legacy mode (options without all): callback receives single address + family", () => {
  const lookup = makePinnedLookup(VETTED_FIRST);
  let received;
  lookup("ignored-host.example", {}, (err, address, family) => {
    received = { err, address, family };
  });
  assert.equal(received.err, null);
  assert.equal(received.address, "8.8.8.8");
  assert.equal(received.family, 4);
});

test("legacy no-options form lookup(host, cb): same single-address payload", () => {
  const lookup = makePinnedLookup(VETTED_FIRST);
  let received;
  // Some Node code paths call lookup with just (host, cb).
  lookup("ignored-host.example", (err, address, family) => {
    received = { err, address, family };
  });
  assert.equal(received.err, null);
  assert.equal(received.address, "8.8.8.8");
  assert.equal(received.family, 4);
});

test("IPv6 family is preserved in both modes", () => {
  const v6 = { address: "2001:4860:4860::8888", family: 6 };
  const lookup = makePinnedLookup(v6);
  let primary;
  lookup("host", { all: true }, (err, list) => {
    primary = { err, list };
  });
  assert.deepEqual(primary.list, [{ address: "2001:4860:4860::8888", family: 6 }]);

  let legacy;
  lookup("host", {}, (err, address, family) => {
    legacy = { err, address, family };
  });
  assert.equal(legacy.address, "2001:4860:4860::8888");
  assert.equal(legacy.family, 6);
});

test("missing callback (signature drift) surfaces a TypeError instead of an opaque crash", () => {
  const lookup = makePinnedLookup(VETTED_FIRST);
  assert.throws(
    () => lookup("host", { all: true }),
    (err) => err instanceof TypeError && /pinned lookup/i.test(err.message),
  );
});
