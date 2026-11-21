// Types mirror the FastAPI responses. All money values are integer cents.

export interface Sample { sample_id: string; name: string; dataset_id: number | null }
export interface Dataset { dataset_id: number; name: string; created_at: string; transaction_count: number }
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
export interface ImportResult { dataset_id: number; name: string; imported_count: number; uncategorised_count: number }

// Canonical fields accepted by the backend importer (importer.ALIASES).
export const FIELDS = ["date", "company", "amount", "direction", "category", "currency", "transaction_id"];

export class ApiError extends Error {
  constructor(message: string, public errors: RowError[] = []) {
    super(message);
  }
}

const UNREACHABLE = "Cannot reach the server. Check the backend is running on port 8000.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(UNREACHABLE);
  }
  const body = await response.json().catch(() => null);
  if (response.ok) return body as T;
  if (body === null) throw new ApiError(UNREACHABLE);

  const detail = body.detail;
  if (Array.isArray(detail)) {  // FastAPI validation error list
    throw new ApiError(detail.map((d: { loc: string[]; msg: string }) => `${d.loc.at(-1)}: ${d.msg}`).join("; "));
  }
  throw new ApiError(detail?.message ?? `Request failed (${response.status}).`, detail?.errors ?? []);
}

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
  summary: (datasetId: number, startDate: string, endDate: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return request<Summary>(`/datasets/${datasetId}/summary?${params}`);
  },
  preview: (file: File, mapping: Record<string, string> | null) =>
    request<Preview>("/datasets/preview", { method: "POST", body: csvForm(file, mapping) }),
  importCsv: (file: File, mapping: Record<string, string> | null) =>
    request<ImportResult>("/datasets", { method: "POST", body: csvForm(file, mapping) }),
};

export function formatMoney(cents: number): string {
  // Integer arithmetic only: whole dollars and remaining cents.
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-AU");
  return `${cents < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
