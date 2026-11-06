import {
  initialProjects,
  initialListings,
  initialBids,
  initialTransactions,
} from "./data";
const defaults = {
  projects: initialProjects,
  listings: initialListings,
  bids: initialBids,
  transactions: initialTransactions,
  deliverables: [],
  messages: [],
  notifications: [],
  audit: [],
  documents: [],
  users: [
    {
      id: "demo-client",
      name: "Grace Achieng",
      email: "client@demo.bautek",
      role: "client",
      status: "Active",
    },
    {
      id: "demo-contractor",
      name: "Daniel Otieno",
      email: "contractor@demo.bautek",
      role: "contractor",
      status: "Active",
    },
    {
      id: "demo-admin",
      name: "Mercy Wanjiku",
      email: "admin@demo.bautek",
      role: "admin",
      status: "Active",
    },
    {
      id: "demo-super",
      name: "Bautek Director",
      email: "superadmin@demo.bautek",
      role: "super_admin",
      status: "Active",
    },
  ],
};
export function getItem(key) {
  try {
    const value = localStorage.getItem("bautek_" + key);
    return value ? JSON.parse(value) : defaults[key] || [];
  } catch {
    return defaults[key] || [];
  }
}
export function setItem(key, value) {
  localStorage.setItem("bautek_" + key, JSON.stringify(value));
  window.dispatchEvent(new Event("bautek-store-change"));
}
export function addItem(key, item) {
  const all = getItem(key);
  setItem(key, [item, ...all]);
  return item;
}
export function updateItem(key, id, changes) {
  const next = getItem(key).map((x) =>
    x.id === id ? { ...x, ...changes } : x,
  );
  setItem(key, next);
}
export function audit(user, action, detail) {
  addItem("audit", {
    id: "AUD-" + Date.now(),
    user: user?.name || "System",
    role: user?.role || "system",
    action,
    detail,
    date: new Date().toISOString(),
  });
}
export function exportCSV(items, filename) {
  const rows = items.map((x) =>
    Object.fromEntries(
      Object.entries(x).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : v,
      ]),
    ),
  );
  if (!rows.length) return;
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const csv = [
    keys.join(","),
    ...rows.map((x) =>
      keys
        .map((k) => '"' + String(x[k] ?? "").replaceAll('"', '""') + '"')
        .join(","),
    ),
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
