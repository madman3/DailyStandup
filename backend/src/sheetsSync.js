import { createHash } from "crypto";
import fs from "fs";
import { google } from "googleapis";
import { upsertJobApplications } from "./lifeosDb.js";

function loadServiceAccountJson() {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  }
  if (inline) return JSON.parse(inline);
  if (b64) return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return null;
}

export function isSheetsSyncConfigured() {
  return Boolean(process.env.GOOGLE_SHEET_ID?.trim() && loadServiceAccountJson());
}

/** Map normalized header cell → column index. */
function buildColumnMap(headerRow) {
  const headers = headerRow.map((c) =>
    String(c ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
  );
  const idx = {};
  const want = {
    id: ["id", "job_id"],
    company: ["company", "employer", "org", "organization"],
    role: ["role", "title", "position", "job_title", "job"],
    status: ["status", "stage", "state"],
    applied_date: ["applied_date", "applied", "date_applied", "date"],
    last_updated: ["last_updated", "updated", "modified"],
    notes: ["notes", "comments", "comment", "details"],
  };
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    for (const [field, aliases] of Object.entries(want)) {
      if (idx[field] !== undefined) continue;
      if (aliases.includes(h)) idx[field] = i;
    }
  }
  return idx;
}

function pick(row, colMap, field) {
  const i = colMap[field];
  if (i === undefined) return null;
  const v = row[i];
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function stableId(company, role, appliedDate, sheetRow1Based) {
  const h = createHash("sha256");
  /** Sheet row disambiguates duplicate-looking dates (e.g. two "May 05" rows / missing year). */
  h.update([company || "", role || "", appliedDate || "", String(sheetRow1Based)].join("|"));
  return h.digest("hex").slice(0, 32);
}

function parseRow(row, colMap, sheetRow1Based) {
  const company = pick(row, colMap, "company");
  const role = pick(row, colMap, "role");
  if (!company && !role) return null;

  let id = pick(row, colMap, "id");
  if (!id) {
    id = stableId(company, role, pick(row, colMap, "applied_date"), sheetRow1Based);
  }

  return {
    id,
    company: company || "",
    role: role || "",
    status: pick(row, colMap, "status"),
    applied_date: pick(row, colMap, "applied_date"),
    last_updated: pick(row, colMap, "last_updated"),
    notes: pick(row, colMap, "notes"),
    sheet_row: sheetRow1Based,
  };
}

/**
 * Pull sheet rows and upsert into job_applications.
 * Expects row 1 to be headers. Recognized headers (any one alias per column):
 * id, company, role, status, applied_date, last_updated, notes (see buildColumnMap).
 */
export async function syncGoogleSheetJobs() {
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const range = process.env.GOOGLE_SHEET_RANGE?.trim() || "Sheet1!A:Z";
  const creds = loadServiceAccountJson();

  if (!sheetId || !creds) {
    return { ok: false, skipped: true, reason: "GOOGLE_SHEET_ID or service account not configured" };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    return { ok: true, upserted: 0, message: "No data rows (need header + at least one row)" };
  }

  const colMap = buildColumnMap(rows[0]);
  if (colMap.company === undefined && colMap.role === undefined) {
    console.warn(
      "[sheets] No 'company' or 'role' column found in header row. Add headers matching docs in .env.example."
    );
    return { ok: false, error: "Missing company/role columns in sheet header" };
  }

  const syncedAt = new Date().toISOString();
  const jobs = [];
  for (let r = 1; r < rows.length; r++) {
    const parsed = parseRow(rows[r], colMap, r + 1);
    if (parsed) jobs.push({ ...parsed, synced_at: syncedAt });
  }

  /** Same explicit id twice in one sheet → last row wins (Postgres rejects duplicate PK in one INSERT). */
  const byId = new Map();
  for (const j of jobs) {
    byId.set(j.id, j);
  }
  const deduped = [...byId.values()];

  await upsertJobApplications(deduped, { replaceAll: true });

  console.info(`[sheets] Synced ${deduped.length} job row(s) from Google Sheet.`);
  return { ok: true, upserted: deduped.length, syncedAt };
}
