/** Match backend `sortTodosForDisplay` ordering. */
export function sortTodosForDisplay(todos) {
  const active = (todos || []).filter((t) => t && t.status === "active");
  return [...active].sort((a, b) => {
    const whenScore = (t) => {
      if (!t.when || !/^\d{4}-\d{2}-\d{2}$/.test(t.when)) return Infinity;
      return new Date(`${t.when}T12:00:00Z`).getTime();
    };
    const wa = whenScore(a);
    const wb = whenScore(b);
    if (wa !== wb) return wa - wb;
    if (Boolean(a.urgent) !== Boolean(b.urgent)) return a.urgent ? -1 : 1;
    if (Boolean(a.important) !== Boolean(b.important)) return a.important ? -1 : 1;
    return (a.title || "").localeCompare(b.title || "");
  });
}

export function todoPriorityBadges(t) {
  const badges = [];
  if (t.urgent) badges.push("Urgent");
  if (t.important) badges.push("Important");
  if (t.when) badges.push(`Due ${t.when}`);
  return badges;
}
