// viewMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.3 + Slice 6 user scope.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import {
  VALID_ULID,
  VALID_ULID_2,
  EVENT_ULID,
  SAMPLE_HASH,
  MockText,
  MockDoc,
  findAll,
  findOne,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  syntheticMatter,
  makeStubApi,
  captureWarn,
  auditEvent,
  deadlineRow,
} from "./_view-matter-dom.mjs";

// --- Tests ---

test("invalid ULID: no IPC call; safe error rendered + back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getCalls = 0;
  const api = makeStubApi({
    getMatter: async () => {
      getCalls++;
      return { ok: true, value: syntheticMatter() };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, "not-a-ulid");
  assert.equal(getCalls, 0);
  const err = findByTestId(root, "view-invalid-id");
  assert.ok(err !== null);
  const link = findByTestId(root, "view-back-link");
  assert.ok(link !== null);
  assert.equal(doc._focused, link);
});

test("envelope error: renders safe message inline with role=alert + back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "invalid_payload",
        message: "invalid payload",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const err = findByTestId(root, "view-envelope-error");
  assert.ok(err !== null);
  const alert = findOne(err, (n) => n.getAttribute("role") === "alert");
  assert.equal(collectText(alert), "invalid payload");
  const link = findByTestId(root, "view-back-link");
  assert.ok(link !== null);
  assert.equal(doc._focused, link);
});

test("value=null: renders not-found copy + back link + focuses back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: null }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const nf = findByTestId(root, "view-not-found");
  assert.ok(nf !== null);
  assert.match(collectText(nf), /link may be out of date/);
  assert.equal(doc._focused, findByTestId(root, "view-back-link"));
});

test("active matter: renders title + status pill + detail fields + Archive button + focuses Archive", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter() }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const title = findByTestId(root, "view-title");
  assert.equal(collectText(title), "matter-fixture-A");
  const pill = findOne(
    root,
    (n) => (n.getAttribute("class") ?? "").startsWith("status-pill"),
  );
  assert.match(pill.getAttribute("class"), /status-pill--active/);
  // Detail fields list
  const fields = findByTestId(root, "view-fields");
  assert.ok(fields !== null);
  assert.match(collectText(fields), /Litigation matter/);
  assert.match(collectText(fields), /test-jx/);
  assert.match(collectText(fields), /Normal/);
  // Archive button visible + focused
  const archive = findByTestId(root, "view-archive");
  assert.ok(archive !== null);
  assert.equal(doc._focused, archive);
});

test("Archive button: navigates to #/matters/:id/archive", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountViewMatter(
    root,
    { api, navigate: (h) => navCalls.push(h), doc },
    VALID_ULID,
  );
  const archive = findByTestId(root, "view-archive");
  archive.dispatchEvent({ type: "click" });
  assert.deepEqual(navCalls, [`#/matters/${VALID_ULID}/archive`]);
});

test("Back link: navigates to #/matters + preventDefault on click", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const navCalls = [];
  const api = makeStubApi();
  await mountViewMatter(
    root,
    { api, navigate: (h) => navCalls.push(h), doc },
    VALID_ULID,
  );
  let prevented = false;
  const back = findByTestId(root, "view-back-link");
  back.dispatchEvent({
    type: "click",
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(navCalls, ["#/matters"]);
});

test("archived matter: NO Archive button; shows 'Reason recorded in audit log.' + focuses back link", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        status: "archived",
        archived_at: "2026-05-27T11:00:00Z",
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(findByTestId(root, "view-archive"), null);
  const fields = findByTestId(root, "view-fields");
  assert.match(collectText(fields), /Reason recorded in audit log\./);
  assert.match(collectText(fields), /Archived at/);
  assert.equal(doc._focused, findByTestId(root, "view-back-link"));
});

test("parties: each party row renders role / display_name / party_kind + optional notes", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        parties: [
          { role: "client", display_name: "syn-A", party_kind: "individual" },
          { role: "counsel", display_name: "syn-B", party_kind: "firm", notes: "fixture-notes" },
        ],
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const parties = findByTestId(root, "view-parties");
  const items = findAll(parties, (n) => n.tagName === "LI");
  assert.equal(items.length, 2);
  assert.match(collectText(items[0]), /client — syn-A \(individual\)/);
  assert.match(collectText(items[1]), /counsel — syn-B \(firm\)/);
  // Notes appear on row 2 only.
  const notes = findAll(items[1], (n) => n.getAttribute("class") === "party-notes");
  assert.equal(notes.length, 1);
  assert.equal(collectText(notes[0]), "fixture-notes");
  const notesOnRow0 = findAll(items[0], (n) => n.getAttribute("class") === "party-notes");
  assert.equal(notesOnRow0.length, 0);
});

test("optional free-text fields: rendered only when non-empty", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        retainer_scope: "scope-text-fixture",
        case_type_text: "",
        court_contact_text: "  ",
        contention_summary_text: "summary-text-fixture",
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const fields = collectText(findByTestId(root, "view-fields"));
  assert.match(fields, /Retainer scope/);
  assert.match(fields, /scope-text-fixture/);
  assert.match(fields, /Contention summary/);
  assert.match(fields, /summary-text-fixture/);
  // Empty + whitespace-only fields NOT rendered.
  assert.doesNotMatch(fields, /Case type/);
  assert.doesNotMatch(fields, /Court contact/);
});

test("HTML-shaped matter name + party display_name render as text only", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        name: "<script>alert(1)</script> matter-fixture-evil",
        parties: [
          {
            role: "<script>x</script>",
            display_name: "<img src=x onerror=evil>",
            party_kind: "individual",
          },
        ],
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  // Title text node carries the literal string verbatim.
  const title = findByTestId(root, "view-title");
  assert.equal(title.children.length, 1);
  assert.ok(title.children[0] instanceof MockText);
  assert.equal(
    title.children[0].textContent,
    "<script>alert(1)</script> matter-fixture-evil",
  );
  // Party row carries the literal too.
  const parties = findByTestId(root, "view-parties");
  assert.match(
    collectText(parties),
    /<script>x<\/script> — <img src=x onerror=evil> \(individual\)/,
  );
});

test("chain head disclosure: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let chainCalls = 0;
  const api = makeStubApi({
    chainHead: async () => {
      chainCalls++;
      return { ok: true, value: { headHash: null, lastEventId: null, count: 0 } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(chainCalls, 0);
  const summary = findByTestId(root, "view-chain-summary");
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(chainCalls, 1);
});

test("chain head: count=0 renders 'No audit events recorded yet.'", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: null, lastEventId: null, count: 0 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const empty = findByTestId(root, "view-chain-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No audit events recorded yet.");
});

test("chain head: present hash renders truncated form via §6.5 rule + full hash inside <details>", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 5 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  // Truncated = first 8 + "..." + last 8
  const trunc = findByTestId(root, "view-chain-headhash-truncated");
  assert.equal(
    collectText(trunc),
    `${SAMPLE_HASH.slice(0, 8)}...${SAMPLE_HASH.slice(-8)}`,
  );
  // Full hash present inside its own disclosure.
  const full = findByTestId(root, "view-chain-headhash-full");
  assert.equal(collectText(full), SAMPLE_HASH);
  // Count rendered.
  const count = findByTestId(root, "view-chain-count");
  assert.equal(collectText(count), "5");
  // Last event short tag = first 8 chars
  const lastShort = findByTestId(root, "view-chain-lastevent-short");
  assert.equal(collectText(lastShort), EVENT_ULID.slice(0, 8));
});

test("chain head: clipboard unavailable in Node → copy button disabled with tooltip", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 1 },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const copy = findByTestId(root, "view-chain-copy");
  assert.ok(copy !== null);
  assert.equal(copy.hasAttribute("disabled"), true);
  assert.equal(copy.getAttribute("title"), "Copy unavailable in this context.");
});

test("chain head: envelope error renders inline with role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "unknown_matter",
        message: "unknown matter",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  const err = findByTestId(root, "view-chain-error");
  assert.equal(collectText(err), "unknown matter");
  assert.equal(err.getAttribute("role"), "alert");
});

test("chain head: clicking summary twice triggers IPC ONCE (lazy + memoized)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let chainCalls = 0;
  const api = makeStubApi({
    chainHead: async () => {
      chainCalls++;
      return { ok: true, value: { headHash: null, lastEventId: null, count: 0 } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const summary = findByTestId(root, "view-chain-summary");
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  summary.dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  assert.equal(chainCalls, 1);
});

test("normal active render emits NO console.warn", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  const result = await captureWarn(() =>
    mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID),
  );
  assert.deepEqual(
    result.calls,
    [],
    `unexpected console.warn: ${JSON.stringify(result.calls)}`,
  );
});

test("jurisdiction locked indicator: shows (locked) when locked=true", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({
        jurisdiction: { value: "test-jx", locked: true },
      }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const fields = collectText(findByTestId(root, "view-fields"));
  assert.match(fields, /test-jx \(locked\)/);
});

test("full ULID disclosure: short tag (8) + full ULID present", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter({ id: VALID_ULID_2 }) }),
  });
  // The route must match the same matter id so the ULID validation accepts it.
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID_2);
  const summary = findByTestId(root, "view-full-id-summary");
  assert.match(collectText(summary), new RegExp(VALID_ULID_2.slice(0, 8)));
  const full = findByTestId(root, "view-full-id");
  assert.equal(collectText(full), VALID_ULID_2);
});

// --- BRCBW... no: audit-event log viewer (this WI) ---

// Flush several macro/microtask turns: the disclosure click triggers

test("audit events: disclosure renders ordered event list (count>0)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 2 },
    }),
    listAuditEvents: async () => ({
      ok: true,
      value: {
        rows: [
          auditEvent({ action: "matter.created" }),
          auditEvent({ action: "matter.archived", reason: "closed" }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  const list = findByTestId(root, "view-audit-list");
  assert.ok(list !== null, "audit list rendered");
  assert.equal(list.tagName, "OL");
  const events = findAllByTestId(root, "view-audit-event");
  assert.equal(events.length, 2);
  const actions = findAllByTestId(root, "view-audit-action").map(collectText);
  assert.deepEqual(actions, ["matter.created", "matter.archived"]);
  // reason shown only when present
  const reasons = findAllByTestId(root, "view-audit-reason").map(collectText);
  assert.deepEqual(reasons, ["reason: closed"]);
  // no "Show more" when next_cursor is null
  assert.equal(findByTestId(root, "view-audit-more"), null);
});

test("audit events: count=0 shows no event list (existing empty copy only)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCalls = 0;
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: null, lastEventId: null, count: 0 },
    }),
    listAuditEvents: async () => {
      listCalls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-chain-empty") !== null);
  assert.equal(findByTestId(root, "view-audit-list"), null);
  assert.equal(listCalls, 0, "listAuditEvents not called for an empty chain");
});

test("audit events: envelope error renders inline role=alert; head summary intact", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 1 },
    }),
    listAuditEvents: async () => ({
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "invalid_payload",
        message: "audit list failed",
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-audit-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "audit list failed");
  // chain head summary still shown (count rendered)
  assert.equal(collectText(findByTestId(root, "view-chain-count")), "1");
});

test("audit events: next_cursor → 'Show more' appends next page then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    chainHead: async () => ({
      ok: true,
      value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 3 },
    }),
    listAuditEvents: async (dto) => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          value: {
            rows: [auditEvent({ action: "ev.one" }), auditEvent({ action: "ev.two" })],
            next_cursor: "cursor-2",
          },
        };
      }
      // second page: cursor must be threaded through
      assert.equal(dto.cursor, "cursor-2");
      return {
        ok: true,
        value: { rows: [auditEvent({ action: "ev.three" })], next_cursor: null },
      };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-audit-event").length, 2);
  const more = findByTestId(root, "view-audit-more");
  assert.ok(more !== null, "Show more present after first page");
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-audit-event").length, 3, "second page appended");
  assert.equal(findByTestId(root, "view-audit-more"), null, "Show more removed when cursor exhausted");
});

// --- Documents section (B2 WI-2a) ---

function docRow(overrides = {}) {
  return {
    id: "01jzdoc0000000000000000000",
    filename: "complaint.pdf",
    doc_type: "pleading",
    status: "registered",
    received_at: "2026-05-27T10:30:00Z",
    ...overrides,
  };
}

test("documents: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let calls = 0;
  const api = makeStubApi({
    listDocuments: async () => {
      calls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(calls, 0);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1);
});

test("documents: empty state shown when no documents", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  const empty = findByTestId(root, "view-docs-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No documents in this matter yet.");
  assert.equal(findAllByTestId(root, "view-docs-item").length, 0);
});

test("documents: populated list renders rows with filename", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({
      ok: true,
      value: {
        rows: [docRow({ filename: "a.pdf" }), docRow({ id: "01jzdoc0000000000000000001", filename: "b.pdf" })],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 2);
  const names = findAllByTestId(root, "view-docs-filename").map(collectText);
  assert.deepEqual(names, ["a.pdf", "b.pdf"]);
  assert.equal(findByTestId(root, "view-docs-empty"), null);
  assert.equal(findByTestId(root, "view-docs-more"), null);
});

test("documents: list envelope error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDocuments: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "docs failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-docs-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "docs failed");
});

test("documents: next_cursor → Show more appends next page then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDocuments: async (dto) => {
      call++;
      if (call === 1) {
        return { ok: true, value: { rows: [docRow({ filename: "p1.pdf" })], next_cursor: "cur-2" } };
      }
      assert.equal(dto.cursor, "cur-2");
      return { ok: true, value: { rows: [docRow({ id: "01jzdoc0000000000000000002", filename: "p2.pdf" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 1);
  const more = findByTestId(root, "view-docs-more");
  assert.ok(more !== null);
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-docs-item").length, 2);
  assert.equal(findByTestId(root, "view-docs-more"), null);
});

test("documents: row details disclosure loads metadata via getDocument", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let getArgs;
  const api = makeStubApi({
    listDocuments: async () => ({ ok: true, value: { rows: [docRow()], next_cursor: null } }),
    getDocument: async (dto) => {
      getArgs = dto;
      return {
        ok: true,
        value: {
          id: dto.documentId,
          filename: "complaint.pdf",
          doc_type: "pleading",
          status: "registered",
          received_at: "2026-05-27T10:30:00Z",
          content_hash: SAMPLE_HASH,
          storage_uri: "file:///local/complaint.pdf",
          page_count: 12,
        },
      };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  // not fetched until the row is expanded
  assert.equal(getArgs, undefined);
  findByTestId(root, "view-docs-item-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(getArgs.matterId, VALID_ULID);
  assert.equal(getArgs.documentId, "01jzdoc0000000000000000000");
  const detail = findByTestId(root, "view-docs-detail");
  assert.ok(detail !== null);
  assert.match(collectText(detail), /file:\/\/\/local\/complaint\.pdf/);
  assert.match(collectText(detail), /12/);
});

// --- Add document (B2 WI-2b) ---

test("add document: success registers (default doc_type) then refreshes the list", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCall = 0;
  let regDto;
  const api = makeStubApi({
    listDocuments: async () => {
      listCall++;
      return listCall === 1
        ? { ok: true, value: { rows: [], next_cursor: null } }
        : { ok: true, value: { rows: [docRow({ filename: "new.pdf" })], next_cursor: null } };
    },
    registerDocument: async (dto) => {
      regDto = dto;
      return { ok: true, value: { id: docRow().id, filename: "new.pdf" } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-docs-empty") !== null);
  const addBtn = findByTestId(root, "view-docs-add");
  assert.ok(addBtn !== null);
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(regDto, { matterId: VALID_ULID, doc_type: "other" });
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "Added.");
  // list refreshed → now shows the registered document
  assert.equal(findAllByTestId(root, "view-docs-item").length, 1);
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add document: cancelled (value null) shows Cancelled, does not refresh", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let listCall = 0;
  const api = makeStubApi({
    listDocuments: async () => {
      listCall++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
    registerDocument: async () => ({ ok: true, value: null }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(listCall, 1);
  findByTestId(root, "view-docs-add").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "Cancelled.");
  assert.equal(listCall, 1, "list not refreshed on cancel");
});

test("add document: registration error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    registerDocument: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "not_implemented", message: "register failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  findByTestId(root, "view-docs-add").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-docs-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "register failed");
});

// --- Deadlines section (B7 read-only) ---


test("deadlines: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let calls = 0;
  const api = makeStubApi({
    listDeadlines: async () => {
      calls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(calls, 0);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1);
});

test("deadlines: empty state when none", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  const empty = findByTestId(root, "view-deadlines-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No deadlines recorded for this matter.");
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 0);
});

test("deadlines: populated rows render due/kind/status (+rule)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({
      ok: true,
      value: {
        rows: [
          deadlineRow({ kind: "filing", status: "pending", source_rule_citation: "FRCP 12(a)" }),
          deadlineRow({ id: "01jzdl00000000000000000001", kind: "hearing", status: "met" }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-deadlines-row").length, 2);
  const kinds = findAllByTestId(root, "view-deadlines-kind").map(collectText);
  assert.deepEqual(kinds, ["filing · pending", "hearing · met"]);
  const rules = findAllByTestId(root, "view-deadlines-rule").map(collectText);
  assert.deepEqual(rules, ["rule: FRCP 12(a)"]);
  assert.equal(findByTestId(root, "view-deadlines-more"), null);
});

test("deadlines: envelope error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listDeadlines: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "deadlines failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-deadlines-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-deadlines-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "deadlines failed");
});

// --- Facts section (B6 read-only) ---

function factRow(overrides = {}) {
  return {
    id: "01jzfact00000000000000000a",
    statement_text: "Defendant filed answer on 2026-06-01.",
    status: "accepted",
    source_type: "lawyer_authored",
    created_at: "2026-06-01T10:30:00Z",
    ...overrides,
  };
}

test("facts: NOT loaded until summary clicked", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let calls = 0;
  const api = makeStubApi({
    listFacts: async () => {
      calls++;
      return { ok: true, value: { rows: [], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  assert.equal(calls, 0);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(calls, 1);
});

test("facts: empty state when none", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listFacts: async () => ({ ok: true, value: { rows: [], next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  const empty = findByTestId(root, "view-facts-empty");
  assert.ok(empty !== null);
  assert.equal(collectText(empty), "No facts recorded for this matter.");
  assert.equal(findAllByTestId(root, "view-facts-row").length, 0);
});

test("facts: populated rows render statement + status·source (+confidence)", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listFacts: async () => ({
      ok: true,
      value: {
        rows: [
          factRow({ statement_text: "Fact A", status: "accepted", source_type: "lawyer_authored" }),
          factRow({
            id: "01jzfact00000000000000000b",
            statement_text: "Fact B",
            status: "candidate",
            source_type: "llm_extraction",
            extraction_confidence: 0.82,
          }),
        ],
        next_cursor: null,
      },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-facts-row").length, 2);
  const statements = findAllByTestId(root, "view-facts-statement").map(collectText);
  assert.deepEqual(statements, ["Fact A", "Fact B"]);
  const statuses = findAllByTestId(root, "view-facts-status").map(collectText);
  assert.deepEqual(statuses, ["accepted · lawyer_authored", "candidate · llm_extraction"]);
  const conf = findAllByTestId(root, "view-facts-confidence").map(collectText);
  assert.deepEqual(conf, ["confidence: 0.82"]);
  assert.equal(findByTestId(root, "view-facts-more"), null);
});

test("facts: envelope error renders inline role=alert", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    listFacts: async () => ({
      ok: false,
      error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "facts failed" },
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "facts failed");
});

test("facts: next_cursor → Show more appends then disappears", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listFacts: async (dto) => {
      call++;
      if (call === 1) return { ok: true, value: { rows: [factRow()], next_cursor: "cur-2" } };
      assert.equal(dto.cursor, "cur-2");
      return { ok: true, value: { rows: [factRow({ id: "01jzfact00000000000000000c" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-facts-row").length, 1);
  const more = findByTestId(root, "view-facts-more");
  assert.ok(more !== null);
  more.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-facts-row").length, 2);
  assert.equal(findByTestId(root, "view-facts-more"), null);
});

// --- Add fact (WI-701 write affordance) ---

// makeStubApi (shared harness) predates the fact-create channel, so wrap it here
// to add a createFact stub without editing the out-of-scope shared harness.
function stubWithFact(impl = {}) {
  return {
    ...makeStubApi(impl),
    createFact: impl.createFact ?? (async () => ({ ok: true, value: {} })),
  };
}

// Mount the matter view, open the Facts disclosure, return its add-control nodes.
async function mountFactsWithAdd(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  return {
    root,
    statement: findByTestId(root, "view-facts-add-statement"),
    purpose: findByTestId(root, "view-facts-add-purpose"),
    asof: findByTestId(root, "view-facts-add-asof"),
    addBtn: findByTestId(root, "view-facts-add"),
  };
}

test("add fact: control renders inside the Facts disclosure", async () => {
  const { root } = await mountFactsWithAdd(stubWithFact());
  assert.ok(findByTestId(root, "view-facts-add-control") !== null);
  // Purpose select offers exactly the 8 R-5 purposes.
  const opts = findAll(findByTestId(root, "view-facts-add-purpose"), (n) => n.tagName === "OPTION");
  assert.deepEqual(
    opts.map((o) => o.getAttribute("value")),
    ["claim", "defense", "counterclaim", "timeline_event", "work_order_result", "consultation_q", "consultation_a", "other"],
  );
  // as_of_date hidden by default (non-timeline default purpose).
  assert.equal(findByTestId(root, "view-facts-add-asof").hasAttribute("hidden"), true);
});

test("add fact: purpose select browser default resolves to 'other', not the first option (WI-703)", async () => {
  // Regression guard for CBW-UI-701-DEFAULT-PURPOSE. Encodes how a real browser
  // resolves an untouched <select>: the option bearing `selected`, else the FIRST
  // option. Pre-fix no option was selected, so the default would have been the
  // first option ("claim"); post-fix "other" is marked selected.
  const { root } = await mountFactsWithAdd(stubWithFact());
  const options = findAll(findByTestId(root, "view-facts-add-purpose"), (n) => n.tagName === "OPTION");
  // Exactly one option is the selected default, and it is "other".
  const selected = options.filter((o) => o.hasAttribute("selected"));
  assert.equal(selected.length, 1, "exactly one option marked selected");
  assert.equal(selected[0].getAttribute("value"), "other");
  // Browser default-resolution rule: selected option, else first.
  const browserDefault = (options.find((o) => o.hasAttribute("selected")) ?? options[0]).getAttribute("value");
  assert.equal(browserDefault, "other", "untouched purpose select must default to 'other'");
  // The first listed option is "claim" — confirming the pre-fix default would have been wrong.
  assert.equal(options[0].getAttribute("value"), "claim");
});

test("add fact: success forwards DTO and refreshes the list in place", async () => {
  let createDto;
  let listCalls = 0;
  const api = stubWithFact({
    listFacts: async () => {
      listCalls++;
      if (listCalls === 1) return { ok: true, value: { rows: [], next_cursor: null } };
      return { ok: true, value: { rows: [factRow({ statement_text: "Newly added." })], next_cursor: null } };
    },
    createFact: async (dto) => {
      createDto = dto;
      return { ok: true, value: { id: "01jzfactnew0000000000000000", statement_text: "Newly added.", status: "candidate", source_type: "lawyer_authored", created_at: "2026-06-05T00:00:00.000Z", matter_id: VALID_ULID } };
    },
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  assert.equal(listCalls, 1);
  statement.value = "Newly added.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "Newly added.", purpose: "other" });
  assert.equal(collectText(findByTestId(root, "view-facts-add-status")), "Added.");
  assert.equal(listCalls, 2, "list refreshed in place");
  const statements = findAllByTestId(root, "view-facts-statement").map(collectText);
  assert.deepEqual(statements, ["Newly added."]);
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add fact: timeline_event reveals + requires as_of_date; switching away hides + drops it", async () => {
  let createDto;
  const api = stubWithFact({ createFact: async (dto) => { createDto = dto; return { ok: true, value: {} }; } });
  const { statement, purpose, asof, addBtn } = await mountFactsWithAdd(api);
  // reveal
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  assert.equal(asof.hasAttribute("hidden"), false);
  assert.equal(asof.getAttribute("aria-required"), "true");
  // switch away → hidden + required state removed
  purpose.value = "claim";
  purpose.dispatchEvent({ type: "change" });
  assert.equal(asof.hasAttribute("hidden"), true);
  assert.equal(asof.hasAttribute("aria-required"), false);
  assert.equal(asof.hasAttribute("required"), false);
  // a stale date value must NOT be forwarded for a non-timeline purpose
  asof.value = "2026-06-15";
  statement.value = "A claim.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "A claim.", purpose: "claim" });
});

test("add fact: timeline_event forwards as_of_date", async () => {
  let createDto;
  const api = stubWithFact({ createFact: async (dto) => { createDto = dto; return { ok: true, value: {} }; } });
  const { statement, purpose, asof, addBtn } = await mountFactsWithAdd(api);
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  asof.value = "2026-06-15";
  statement.value = "Event happened.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(createDto, { matterId: VALID_ULID, statement_text: "Event happened.", purpose: "timeline_event", as_of_date: "2026-06-15" });
});

test("add fact: empty statement → inline error, createFact NOT called", async () => {
  let called = false;
  const api = stubWithFact({ createFact: async () => { called = true; return { ok: true, value: {} }; } });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "   "; // whitespace only
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("add fact: backend error envelope → inline role=alert, no refresh, button re-enabled", async () => {
  let listCalls = 0;
  const api = stubWithFact({
    listFacts: async () => { listCalls++; return { ok: true, value: { rows: [], next_cursor: null } }; },
    createFact: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "invalid_payload", message: "statement_text must be a non-empty string" } }),
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  assert.equal(listCalls, 1);
  statement.value = "A fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "statement_text must be a non-empty string");
  assert.equal(listCalls, 1, "list NOT refreshed on error");
  assert.equal(addBtn.hasAttribute("disabled"), false);
});

test("add fact: timeline_event with empty as_of_date → client precheck, createFact NOT called", async () => {
  let called = false;
  const api = stubWithFact({ createFact: async () => { called = true; return { ok: true, value: {} }; } });
  const { root, statement, purpose, addBtn } = await mountFactsWithAdd(api);
  purpose.value = "timeline_event";
  purpose.dispatchEvent({ type: "change" });
  statement.value = "Event with no date.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false, "createFact not called when the timeline date is empty");
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("add fact: createFact rejection → generic inline alert, button re-enabled (no unhandled rejection)", async () => {
  const api = stubWithFact({ createFact: async () => { throw new Error("ipc transport boom"); } });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "A fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "Could not add the fact. Please try again.");
  assert.equal(addBtn.hasAttribute("disabled"), false, "button re-enabled in finally");
});

test("add fact: a superseded (stale) load cannot mutate the refreshed list", async () => {
  // The initial load hangs; the post-add refresh supersedes it. When the stale
  // initial response finally resolves, the generation guard must drop it.
  const pending = [];
  let n = 0;
  const api = stubWithFact({
    listFacts: async () => {
      n++;
      if (n === 1) return new Promise((res) => pending.push(res)); // initial: hangs
      return { ok: true, value: { rows: [factRow({ statement_text: "Refreshed." })], next_cursor: null } };
    },
    createFact: async () => ({ ok: true, value: {} }),
  });
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" }); // load #1 (hangs)
  await flush();
  findByTestId(root, "view-facts-add-statement").value = "Refreshed.";
  findByTestId(root, "view-facts-add").dispatchEvent({ type: "click" }); // create + refresh (#2)
  await flush();
  assert.deepEqual(findAllByTestId(root, "view-facts-statement").map(collectText), ["Refreshed."]);
  // Resolve the stale initial load now — it must NOT inject its row.
  pending[0]({ ok: true, value: { rows: [factRow({ statement_text: "STALE." })], next_cursor: null } });
  await flush();
  assert.deepEqual(
    findAllByTestId(root, "view-facts-statement").map(collectText),
    ["Refreshed."],
    "stale load dropped by the generation guard",
  );
});

test("add fact: unknown_matter envelope → inline role=alert with server message", async () => {
  const api = stubWithFact({
    createFact: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "unknown_matter", message: "matter not found" } }),
  });
  const { root, statement, addBtn } = await mountFactsWithAdd(api);
  statement.value = "Some fact.";
  addBtn.dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-add-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), "matter not found");
});
