/**
 * @typedef {'priority' | 'schedule' | 'quick' | 'backlog' | 'unsorted'} TodoQuadrant
 * @typedef {{ id: string, title: string, completedAt: string, dateKey: string }} RecentAccomplishment
 */

/** Fixed Eisenhower tabs + catch-all for ambiguous flags. */
export const TODO_TABS = /** @type {const} */ ([
  { id: "priority", label: "Priority" },
  { id: "schedule", label: "Schedule" },
  { id: "quick", label: "Quick" },
  { id: "backlog", label: "Backlog" },
  { id: "unsorted", label: "Unsorted" },
]);

/**
 * @param {{ important?: boolean | null, urgent?: boolean | null }} t
 * @returns {TodoQuadrant}
 */
export function todoQuadrant(t) {
  const imp = t.important;
  const urg = t.urgent;
  if (imp === null || imp === undefined || urg === null || urg === undefined) {
    return "unsorted";
  }
  if (urg && imp) return "priority";
  if (imp && !urg) return "schedule";
  if (urg && !imp) return "quick";
  return "backlog";
}

/**
 * @param {TodoQuadrant} quadrant
 * @returns {{ important: boolean, urgent: boolean } | null} null only for unsorted (clears to null in API)
 */
export function quadrantToFlags(quadrant) {
  switch (quadrant) {
    case "priority":
      return { important: true, urgent: true };
    case "schedule":
      return { important: true, urgent: false };
    case "quick":
      return { important: false, urgent: true };
    case "backlog":
      return { important: false, urgent: false };
    case "unsorted":
      return null;
    default:
      return null;
  }
}

/**
 * @param {TodoQuadrant} quadrant
 * @param {unknown[]} todos
 */
export function sortTodosInQuadrant(todos, quadrant) {
  const list = (todos || []).filter((t) => t && t.status === "active" && todoQuadrant(t) === quadrant);
  return [...list].sort((a, b) => {
    const oa = a.sortOrder?.[quadrant];
    const ob = b.sortOrder?.[quadrant];
    if (oa != null && ob != null && oa !== ob) return oa - ob;
    if (oa != null && ob == null) return -1;
    if (oa == null && ob != null) return 1;
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    return ca.localeCompare(cb);
  });
}

const MS_DAY = 86400000;

/**
 * Accomplishments from all days within the last `days` calendar days (by completedAt).
 * @param {Record<string, { accomplishments?: Array<{ id: string, title: string, completedAt: string }> }> | undefined} days
 * @param {number} [withinDays]
 */
export function recentAccomplishmentsFromDays(days, withinDays = 7) {
  const cutoff = Date.now() - withinDays * MS_DAY;
  const out = [];
  for (const [dateKey, day] of Object.entries(days || {})) {
    for (const a of day?.accomplishments || []) {
      if (!a?.completedAt) continue;
      const t = new Date(a.completedAt).getTime();
      if (!Number.isFinite(t) || t < cutoff) continue;
      out.push({ ...a, dateKey });
    }
  }
  out.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return out;
}
