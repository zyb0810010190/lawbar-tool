// Tiny hash router for the case-box UI.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §6 + §9.3 + D7.
//
// Routes:
//   #/matters                  → "list"
//   #/matters/new              → "new"
//   #/matters/:id              → "view"   (id must match ULID regex)
//   #/matters/:id/archive      → "archive" (id must match ULID regex)
//   #/matters/:id/edit         → "edit"   (id must match ULID regex)
//   #/settings                 → "settings"
//   #/backup                   → "backup"
//   anything else              → "not-found"

export type RouteName =
  | "list"
  | "new"
  | "view"
  | "archive"
  | "edit"
  | "settings"
  | "backup"
  | "not-found";

export interface ParsedRoute {
  readonly name: RouteName;
  readonly params: { readonly id?: string };
}

// 26-char Crockford base32 lowercase ULID per IPC contract §6.0. Crockford's
// alphabet excludes `i`, `l`, `o`, and `u` to avoid confusion with `1` / `0`
// / `v`. The character class below mirrors that restriction.
const ULID_RE = /^[0-9a-hjkmnp-tv-z]{26}$/;

export function parseHash(hash: string): ParsedRoute {
  // Drop leading "#"; treat empty hash as root.
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // Drop optional leading "/" so "/matters" and "matters" both work.
  const path = raw.startsWith("/") ? raw.slice(1) : raw;

  if (path === "" || path === "matters") {
    return { name: "list", params: {} };
  }
  if (path === "matters/new") {
    return { name: "new", params: {} };
  }
  if (path === "backup") {
    return { name: "backup", params: {} };
  }
  if (path === "settings") {
    return { name: "settings", params: {} };
  }

  // matters/:id  OR  matters/:id/archive
  const parts = path.split("/");
  if (parts.length === 2 && parts[0] === "matters") {
    const id = parts[1];
    if (ULID_RE.test(id)) {
      return { name: "view", params: { id } };
    }
    return { name: "not-found", params: {} };
  }
  if (parts.length === 3 && parts[0] === "matters" && parts[2] === "archive") {
    const id = parts[1];
    if (ULID_RE.test(id)) {
      return { name: "archive", params: { id } };
    }
    return { name: "not-found", params: {} };
  }
  if (parts.length === 3 && parts[0] === "matters" && parts[2] === "edit") {
    const id = parts[1];
    if (ULID_RE.test(id)) {
      return { name: "edit", params: { id } };
    }
    return { name: "not-found", params: {} };
  }

  return { name: "not-found", params: {} };
}

export function buildHash(name: RouteName, params: { id?: string } = {}): string {
  switch (name) {
    case "list":
      return "#/matters";
    case "new":
      return "#/matters/new";
    case "backup":
      return "#/backup";
    case "settings":
      return "#/settings";
    case "view":
      if (params.id === undefined) throw new Error("buildHash(view): id required");
      return `#/matters/${params.id}`;
    case "archive":
      if (params.id === undefined) throw new Error("buildHash(archive): id required");
      return `#/matters/${params.id}/archive`;
    case "edit":
      if (params.id === undefined) throw new Error("buildHash(edit): id required");
      return `#/matters/${params.id}/edit`;
    case "not-found":
      return "#/not-found";
  }
}

// Optional helper: subscribe to hashchange and re-render.
// Tests do NOT exercise this (no real `window`); screens consume it directly.
export type RouteHandler = (route: ParsedRoute) => void | Promise<void>;

export function attachRouter(handler: RouteHandler): () => void {
  const onChange = (): void => {
    void handler(parseHash(window.location.hash));
  };
  window.addEventListener("hashchange", onChange);
  // Fire once for initial route.
  onChange();
  return () => window.removeEventListener("hashchange", onChange);
}
