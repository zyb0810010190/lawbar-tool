// Sidebar nav current-state helper (PR3 — fixes UISHELL-L1).
//
// The desktop shell's sidebar links are static markup in index.html. Before
// this module the Matters link hardcoded `aria-current="page"`, so assistive
// tech announced "Matters" as the current page even on #/matters/new. This
// drives `aria-current` from the active hash route instead.
//
// Policy: mark a sidebar link `aria-current="page"` ONLY when the route IS that
// link's exact page. Detail/archive/not-found are not the list page nor the
// new-matter page, so no sidebar link is marked current there (avoids the
// inverse of the original bug — claiming a link is the current page when it
// isn't). Section-level highlighting for detail routes is a deliberate non-goal
// for this fix.

export type NavKey = "list" | "new" | "settings";

// Which sidebar nav link (if any) is the current PAGE for a route name.
export function activeNavKey(routeName: string): NavKey | null {
  switch (routeName) {
    case "list":
      return "list";
    case "new":
      return "new";
    case "settings":
      return "settings";
    default:
      // view / archive / not-found: no sidebar link is the exact page.
      return null;
  }
}

// Apply `aria-current="page"` to the matching `.sidebar-link[data-nav]` and
// clear it from the others. Pure over an injected Document so it is testable
// under plain node:test.
export function applySidebarCurrent(doc: Document, routeName: string): void {
  const key = activeNavKey(routeName);
  const links = doc.querySelectorAll(".sidebar-link[data-nav]");
  links.forEach((node) => {
    const link = node as HTMLElement;
    if (key !== null && link.getAttribute("data-nav") === key) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}
