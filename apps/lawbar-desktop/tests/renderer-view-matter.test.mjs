// viewMatter screen tests. Pure-Node; mock document + mock api injected.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6.3 + Slice 6 user scope.

import { test } from "node:test";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import {
  VALID_ULID,
  VALID_ULID_2,
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
  // Displayed text is the zh-CN catalog message keyed by the stable error CODE,
  // never the raw English env.error.message (logs only).
  assert.equal(collectText(alert), CATALOG["error.invalid_payload"]);
  assert.doesNotMatch(collectText(alert), /invalid payload/);
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
  assert.match(collectText(nf), /链接可能已失效/);
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
  assert.match(collectText(fields), /诉讼/);
  assert.match(collectText(fields), /test-jx/);
  assert.match(collectText(fields), /普通/);
  // Archive button visible + focused
  const archive = findByTestId(root, "view-archive");
  assert.ok(archive !== null);
  assert.equal(doc._focused, archive);
});

test("detail desktop layout (PR3): view-desktop grid + view-card + meta-strip + colophon + archive-pull", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({ ok: true, value: syntheticMatter() }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const byClass = (cls) =>
    findOne(root, (n) => (n.getAttribute("class") ?? "").split(/\s+/).includes(cls));
  assert.ok(byClass("view-desktop"), "expected the .view-desktop two-column grid");
  assert.ok(byClass("view-card"), "expected the .view-card info panel");
  assert.ok(byClass("view-meta-strip"), "expected the .view-meta-strip eyebrows");
  assert.ok(byClass("colophon"), "expected the .colophon aside");
  assert.ok(byClass("view-aside"), "expected the .view-aside column");
  assert.ok(byClass("archive-pull"), "active matter shows the .archive-pull danger card");
  // The archive button lives INSIDE the archive-pull card.
  const pull = byClass("archive-pull");
  assert.ok(
    findOne(pull, (n) => n.getAttribute("data-test-id") === "view-archive") !== null,
    "Archive button is inside the danger-zone card",
  );
});

test("detail desktop layout (PR3): archived matter shows no archive-pull, keeps archived marker", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    getMatter: async () => ({
      ok: true,
      value: syntheticMatter({ status: "archived", archived_at: "2026-05-28T00:00:00Z" }),
    }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  const byClass = (cls) =>
    findOne(root, (n) => (n.getAttribute("class") ?? "").split(/\s+/).includes(cls));
  assert.equal(byClass("archive-pull"), null, "archived matter has no danger-zone card");
  assert.ok(byClass("view-archived-marker"), "archived marker present");
  assert.ok(byClass("view-desktop"), "still uses the desktop grid");
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

test("archived matter: NO Archive button; shows the archive-reason copy + focuses back link", async () => {
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
  assert.match(collectText(fields), /原因记录于审计日志。/);
  assert.match(collectText(fields), /归档时间/);
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
  assert.match(collectText(items[0]), /委托人 — syn-A \(个人\)/);
  // "counsel" and "firm" are not migrated enum values → they pass through raw (English).
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
  assert.match(fields, /委托范围/);
  assert.match(fields, /scope-text-fixture/);
  assert.match(fields, /争议焦点/);
  assert.match(fields, /summary-text-fixture/);
  // Empty + whitespace-only fields NOT rendered.
  assert.doesNotMatch(fields, /案由/);
  assert.doesNotMatch(fields, /法院联系人/);
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
    /<script>x<\/script> — <img src=x onerror=evil> \(个人\)/,
  );
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

test("jurisdiction locked indicator: shows the locked marker when locked=true", async () => {
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
  assert.match(fields, /test-jx \(已锁定\)/);
});

test("WI-i18n-3: detail main route uses the i18n catalog/facade (zh-CN, no hardcoded labels)", async () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "renderer", "screens", "viewMatter.ts"),
    "utf8",
  );
  // Enum labels come from the shared facade, not format.ts.
  assert.match(src, /from "\.\.\/i18n\/labels\.js"/, "must import enum-label facade");
  assert.match(src, /from "\.\.\/i18n\/t\.js"/, "must import t()");
  // format.ts is imported ONLY for the language-neutral utils (no label helpers).
  assert.match(src, /import \{ formatLocalDateTime, ulidShort \} from "\.\.\/format\.js"/, "format.ts gives only date/id utils");
  // No leftover English main-route chrome literals (spot-check a few migrated strings).
  for (const gone of ["Matter not found", "Loading matter", "Danger zone", "Archive…", "Back to matters"]) {
    assert.ok(!src.includes(`"${gone}"`) && !src.includes(`["${gone}"]`), `migrated literal still present: ${gone}`);
  }
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
  assert.equal(collectText(empty), "本案件暂无文档。");
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
  assert.equal(collectText(err), CATALOG["error.invalid_payload"]);
  assert.doesNotMatch(collectText(err), /docs failed/);
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
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "已添加。");
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
  assert.equal(collectText(findByTestId(root, "view-docs-add-status")), "已取消。");
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
  assert.equal(collectText(err), CATALOG["error.not_implemented"]);
  assert.doesNotMatch(collectText(err), /register failed/);
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
  assert.equal(collectText(empty), "本案暂无期限记录。");
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
  // WI-DESKTOP-ZH-CN-I18N-COMPLETE-01: kind + status render via the zh-CN label
  // facades (deadlineKindLabel/deadlineStatusLabel), not the raw contract enum.
  assert.deepEqual(kinds, [
    `${CATALOG["deadlineKind.filing"]} · ${CATALOG["deadlineStatus.pending"]}`,
    `${CATALOG["deadlineKind.hearing"]} · ${CATALOG["deadlineStatus.met"]}`,
  ]);
  const rules = findAllByTestId(root, "view-deadlines-rule").map(collectText);
  assert.deepEqual(rules, ["依据：FRCP 12(a)"]);
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
  assert.equal(collectText(err), CATALOG["error.invalid_payload"]);
  assert.doesNotMatch(collectText(err), /deadlines failed/);
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
  assert.equal(collectText(empty), "本案暂无已记录的事实。");
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
  // fact.status migrated (accepted→已采纳, candidate→待处理); source_type: llm_extraction→LLM 抽取
  // is migrated, but "lawyer_authored" is not a catalog key so it passes through raw (English).
  assert.deepEqual(statuses, ["已采纳 · lawyer_authored", "待处理 · LLM 抽取"]);
  const conf = findAllByTestId(root, "view-facts-confidence").map(collectText);
  assert.deepEqual(conf, ["置信度：0.82"]);
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
  assert.equal(collectText(err), CATALOG["error.invalid_payload"]);
  assert.doesNotMatch(collectText(err), /facts failed/);
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

// --- WI-AP2: pagination re-entrancy guards + accessibility ---

test("documents: rapid double-click on Show more does not double-fetch or double-append", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listDocuments: async () => {
      call++;
      if (call === 1) return { ok: true, value: { rows: [docRow({ filename: "p1.pdf" })], next_cursor: "cur-2" } };
      return { ok: true, value: { rows: [docRow({ id: "01jzdoc0000000000000000003", filename: "p2.pdf" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  const more = findByTestId(root, "view-docs-more");
  more.dispatchEvent({ type: "click" });
  more.dispatchEvent({ type: "click" }); // concurrent — guard must drop this
  await flush();
  assert.equal(call, 2, "exactly one extra fetch despite the double-click");
  assert.equal(findAllByTestId(root, "view-docs-item").length, 2, "second page appended exactly once");
});

test("facts: rapid double-click on Show more does not double-fetch or double-append", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  let call = 0;
  const api = makeStubApi({
    listFacts: async () => {
      call++;
      if (call === 1) return { ok: true, value: { rows: [factRow()], next_cursor: "cur-2" } };
      return { ok: true, value: { rows: [factRow({ id: "01jzfact00000000000000000d" })], next_cursor: null } };
    },
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  const more = findByTestId(root, "view-facts-more");
  more.dispatchEvent({ type: "click" });
  more.dispatchEvent({ type: "click" }); // concurrent — guard must drop this
  await flush();
  assert.equal(call, 2, "exactly one extra fetch despite the double-click");
  assert.equal(findAllByTestId(root, "view-facts-row").length, 2, "second page appended exactly once");
});

test("a11y: document controls expose aria-labels", async () => {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi();
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-docs-summary").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findByTestId(root, "view-docs-add-type").getAttribute("aria-label"), "文档类型");
  assert.equal(findByTestId(root, "view-docs-add").getAttribute("aria-label"), "添加文档");
});
