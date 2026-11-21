// Types mirror the FastAPI responses. All money values are integer cents.

export interface Sample { sample_id: string; name: string; description: string; dataset_id: number | null }
export interface Fixture { fixture_id: string; name: string; outcome: string; description: string }
export interface CsvPreview {
  file_name: string;
  columns: string[];
  rows: string[][];
  row_count: number;
  missing_category_count: number | null;  // null = file has no category column
}
export interface Dataset {
  dataset_id: number;
  name: string;
  created_at: string;
  transaction_count: number;
  source: string;  // "sample:<id>", "fixture:<id>" or "upload"
}
export interface DatasetList { samples: Sample[]; datasets: Dataset[] }

export interface CategoryTotal { category: string | null; amount_cents: number }
export interface MonthTotal { month: string; income_cents: number; expenses_cents: number }
export interface Summary {
  start_date: string | null;
  end_date: string | null;
  total_income_cents: number;
  total_expenses_cents: number;
  net_cents: number;
  income_count: number;
  expense_count: number;
  income_by_category: CategoryTotal[];
  expenses_by_category: CategoryTotal[];
  monthly: MonthTotal[];
  uncategorised_count: number;
  uncategorised_cents: number;
  summary_text: string;
}

export interface RowError { row: number | null; field: string | null; message: string }
export interface Preview {
  columns: string[];
  mapping: Record<string, string>;
  unmapped_columns: string[];
  missing_fields: string[];
  row_count: number;
  uncategorised_count: number;
  valid: boolean;
  error_count: number;
  errors: RowError[];
}
export interface Transaction {
  transaction_id: string;
  dataset_id: number;
  date: string;
  company: string;
  category: string | null;
  direction: "INCOMING" | "OUTGOING";
  amount_cents: number;
  currency: string;
}

export interface TransactionFilters { category: string; direction: string }

export interface ImportResult { dataset_id: number; name: string; imported_count: number; uncategorised_count: number }

// Category filter value the backend uses for "no category" (the review queue).
export const UNCATEGORISED = "uncategorised";

// Canonical fields accepted by the backend importer (importer.ALIASES).
export const FIELDS = ["date", "company", "amount", "direction", "category", "currency", "transaction_id"];

export class ApiError extends Error {
  // status 0 = no response (network failure); otherwise the HTTP status.
  constructor(message: string, public errors: RowError[] = [], public code = "", public status = 0) {
    super(message);
  }
}

// A 4xx answer means the server refused the request and changed nothing. A network failure or 5xx
// is ambiguous: the server may have committed the change before the response was lost.
export const isRejection = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

const UNREACHABLE = "Cannot reach the server. Check the backend is running on port 8000.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(UNREACHABLE);
  }
  const text = await response.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: handled below.
  }
  if (response.ok) return body as T;
  if (body === null) {
    // The Vite proxy answers with an empty 5xx when the backend is down; FastAPI's own crash page
    // is the plain text "Internal Server Error". Neither body is shown to the user.
    throw new ApiError(text === "" || response.status >= 502 ? UNREACHABLE
      : `The server encountered an error (${response.status}). Try again, or check the backend log.`,
      [], "", response.status);
  }

  const detail = body.detail;
  if (Array.isArray(detail)) {  // FastAPI validation error list
    throw new ApiError(detail.map((d: { loc: string[]; msg: string }) => `${d.loc.at(-1)}: ${d.msg}`).join("; "),
      [], "", response.status);
  }
  throw new ApiError(detail?.message ?? `Request failed (${response.status}).`, detail?.errors ?? [], detail?.code ?? "",
    response.status);
}

// Only non-empty values become query parameters.
const query = (params: Record<string, string>) =>
  new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();

function csvForm(file: File, mapping: Record<string, string> | null): FormData {
  const form = new FormData();
  form.append("file", file);
  if (mapping) form.append("mapping", JSON.stringify(mapping));
  return form;
}

export const api = {
  datasets: () => request<DatasetList>("/datasets"),
  loadSample: (sampleId: string) =>
    request<{ dataset_id: number }>(`/datasets/${sampleId}/load`, { method: "POST" }),
  summary: (datasetId: number) => request<Summary>(`/datasets/${datasetId}/summary`),
  transactions: (datasetId: number, filters: Partial<TransactionFilters> = {}) =>
    request<Transaction[]>(`/datasets/${datasetId}/transactions?${query(filters)}`),
  categories: () => request<{ categories: string[] }>("/categories"),
  fixtures: () => request<Fixture[]>("/fixtures"),
  samplePreview: (sampleId: string) => request<CsvPreview>(`/samples/${sampleId}/preview`),
  fixturePreview: (fixtureId: string) => request<CsvPreview>(`/fixtures/${fixtureId}/preview`),
  // The real example file, so it goes through the same preview/import flow as an upload.
  fixtureFile: async (fixtureId: string) => {
    const response = await fetch(`/api/fixtures/${fixtureId}/file`).catch(() => {
      throw new ApiError(UNREACHABLE);
    });
    if (!response.ok) throw new ApiError(`Could not load the example file (${response.status}).`);
    return new File([await response.blob()], `${fixtureId}.csv`, { type: "text/csv" });
  },
  setCategory: (datasetId: number, transactionId: string, category: string) =>
    request<Transaction>(`/datasets/${datasetId}/transactions/${encodeURIComponent(transactionId)}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    }),
  preview: (file: File, mapping: Record<string, string> | null) =>
    request<Preview>("/datasets/preview", { method: "POST", body: csvForm(file, mapping) }),
  importCsv: (file: File, mapping: Record<string, string> | null) =>
    request<ImportResult>("/datasets", { method: "POST", body: csvForm(file, mapping) }),
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const countLabel = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;

// Fixed three-letter months, parsed from the ISO string (no time zones): "2026-06-30" → "30 Jun 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatMonth = (yyyyMm: string) => `${MONTHS[Number(yyyyMm.slice(5, 7)) - 1]} ${yyyyMm.slice(2, 4)}`;
export const formatDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function formatMoney(cents: number): string {
  // Integer arithmetic only: whole dollars and remaining cents.
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-AU");
  return `${cents < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
