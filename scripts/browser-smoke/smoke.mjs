// Browser smoke test. Run through ./run.sh, which starts an isolated backend and frontend.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.APP_URL;
const API = process.env.API_URL;
const DB = process.env.DB;  // the run's temporary database, read directly to count audit rows
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!URL || !API || !DB) throw new Error("Run via ./run.sh (APP_URL, API_URL and DB must be set).");
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);
let pass = 0, fail = 0;
const check = (name, ok, info = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + info}`); };
const sql = (q) => execFileSync("python3", ["-c",
  "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchone()[0])", DB, q]).toString().trim();
const api = async (p, init) => (await fetch(API + p, init)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const text = () => page.evaluate(() => document.body.innerText);
const cards = () => page.$$eval(".stat", (els) => els.map((e) => [e.querySelector(".stat-label").textContent, e.querySelector(".stat-value").textContent]));
const select = (v) => page.select(".setup select", v);
const runBtn = () => page.$eval(".button.run", (b) => ({ disabled: b.disabled, text: b.textContent }));
async function run() { await page.click(".button.run"); await page.waitForFunction(() => !document.querySelector(".button.run")?.textContent.includes("Running")); await sleep(300); }
const money = (c) => { const a = Math.abs(c); return `${c < 0 ? "-" : ""}$${Math.floor(a / 100).toLocaleString("en-AU")}.${String(a % 100).padStart(2, "0")}`; };

// 1. Open: nothing analysed
await page.goto(URL, { waitUntil: "networkidle0" });
check("opens with no figures", (await page.$$(".stat")).length === 0);
check("Run disabled initially", (await runBtn()).disabled);

// 2. Sample → Run Insights
await select("sample:missing-categories");
await run();
const { dataset_id: id } = await api("/datasets/missing-categories/load", { method: "POST" });
const s0 = await api(`/datasets/${id}/summary`);
const c0 = Object.fromEntries(await cards());
check("income card = API", c0["Total income"] === money(s0.total_income_cents), JSON.stringify(c0));
check("expenses card = API", c0["Total expenses"] === money(s0.total_expenses_cents));
check("net card = API", c0["Net cash flow"] === money(s0.net_cents));
check("needs review card = API", c0["Needs review"] === String(s0.uncategorised_count));
check("two charts rendered", (await page.$$(".recharts-surface")).length >= 2);
const reviewRows = await page.$$("tr.needs-review");
check("highlighted rows = uncategorised", reviewRows.length === s0.uncategorised_count, `${reviewRows.length}`);

// 3a. Confirmed rejection (simulated 422 response) → "Not saved", nothing written
const audits = () => Number(sql(`select count(*) from category_audit where dataset_id=${id}`));
const audits0 = audits();
await page.setRequestInterception(true);
const reject = (r) => (r.method() === "PATCH" ? r.respond({ status: 422, contentType: "application/json",
  body: JSON.stringify({ detail: { code: "invalid_category", message: "Category is not approved." } }) }) : r.continue());
page.on("request", reject);
const row = (await page.$$("tr.needs-review"))[0];
const isExpense = (await row.$eval("td:nth-child(4)", (td) => td.textContent)) === "Expense";
const cat = isExpense ? "Supplies" : "Sales";
await (await row.$("select")).select(cat);
await (await row.$("button")).click();
await page.waitForSelector(".row-error");
check("rejected save says Not saved", (await page.$eval(".row-error", (e) => e.textContent)).startsWith("Not saved"));
check("rejected save: no success banner", !(await text()).includes("is now categorised"));
check("rejected save: no audit row", audits() === audits0);
page.off("request", reject);

// 3b. Lost response: the PATCH really reaches the backend and commits, then the browser's
// connection is aborted. The UI must not claim "Not saved"; it reloads the server state.
const lose = async (r) => {
  if (r.method() !== "PATCH") return r.continue();
  await fetch(API + new globalThis.URL(r.url()).pathname.replace(/^\/api/, ""),
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: r.postData() });
  r.abort();
};
page.on("request", lose);
const lostRow = (await page.$$("tr.needs-review"))[0];
const lostCat = (await lostRow.$eval("td:nth-child(4)", (td) => td.textContent)) === "Expense" ? "Supplies" : "Sales";
await (await lostRow.$("select")).select(lostCat);
await (await lostRow.$("button")).click();
await page.waitForFunction(() => document.body.innerText.includes("Could not confirm whether"));
page.off("request", lose);
await page.setRequestInterception(false);
await page.waitForFunction((n) => [...document.querySelectorAll(".stat")].some((e) =>
  e.querySelector(".stat-label").textContent === "Needs review" && e.querySelector(".stat-value").textContent === n),
  {}, String(s0.uncategorised_count - 1));
check("lost response: not reported as Not saved", !(await text()).includes("Not saved"));
check("lost response: committed once on the server", audits() === audits0 + 1);
check("lost response: reload shows saved state", (await page.$$("tr.needs-review")).length === s0.uncategorised_count - 1);
const lostId = sql(`select transaction_id from category_audit where dataset_id=${id} order by audit_id desc`);
await fetch(`${API}/datasets/${id}/transactions/${lostId}/category`, { method: "PATCH",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: lostCat }) });
check("lost response: retrying same category adds no audit row", audits() === audits0 + 1);

// 4. Successful save → audit, breakdown updates, totals unchanged
const row2 = (await page.$$("tr.needs-review"))[0];
const company2 = await row2.$eval("td:nth-child(2)", (td) => td.textContent);
await (await row2.$("select")).select(cat);
await (await row2.$("button")).click();
await page.waitForFunction((c) => document.body.innerText.includes(`${c} (`) && document.body.innerText.includes("is now categorised"), {}, company2);
await sleep(600);
check("audit row written", audits() === audits0 + 2);
const s1 = await api(`/datasets/${id}/summary`);
const c1 = Object.fromEntries(await cards());
check("totals unchanged after save", s1.total_income_cents === s0.total_income_cents && s1.net_cents === s0.net_cents
  && c1["Total income"] === c0["Total income"] && c1["Net cash flow"] === c0["Net cash flow"]);
check("needs review card decremented", c1["Needs review"] === String(s0.uncategorised_count - 2), c1["Needs review"]);
check("highlighted rows decremented", (await page.$$("tr.needs-review")).length === s0.uncategorised_count - 2);

// 5. Invalid CSV scenario: errors, Run disabled, nothing stored
const datasets0 = sql("select count(*) from datasets");
await select("fixture:invalid-amount");
await page.waitForSelector(".row-errors");
check("invalid amount shows row errors", (await page.$$(".row-errors li")).length >= 3);
check("invalid amount: Run disabled", (await runBtn()).disabled);
await select("fixture:missing-required-column");
await page.waitForFunction(() => document.body.innerText.includes("Missing required column"));
check("missing column message", true);
check("missing column: Run disabled", (await runBtn()).disabled);
await select("fixture:unknown-headers");
await page.waitForFunction(() => document.body.innerText.includes("Map a column to"));
check("unknown headers asks for mapping", true);
check("rejects stored nothing", sql("select count(*) from datasets") === datasets0);

// 6. Rapid switching: fixture then sample immediately → no stale mapping table
await select("fixture:explicit-direction");
await select("sample:small-business");
await sleep(800);
check("rapid switch: no stale mapping shown", (await page.$$("table.mapping:not(.csv-table)")).length === 0);

// 7. Stale run: slow load of A, then switch to B and run → B shown
await page.setRequestInterception(true);
const slow = async (r) => { if (r.url().includes("/retail-business/load")) await sleep(1500); r.continue(); };
page.on("request", slow);
await select("sample:retail-business");
await page.click(".button.run");
await sleep(100);
await select("sample:freelancer");
await run();
await sleep(2000);
page.off("request", slow);
await page.setRequestInterception(false);
const h = await page.$eval(".results-head h2", (e) => e.textContent);
check("stale run cannot overwrite newer", h === "Insights for Freelancer", h);

// 8a. Scenario re-run reuses the dataset (no duplicate)
await select("fixture:signed-amount");
await page.waitForFunction(() => document.body.innerText.includes("Ready:"));
await run();
const afterFirst = sql("select count(*) from datasets");
await select("fixture:signed-amount");
await sleep(800);
await run();
check("scenario re-run reuses dataset", sql("select count(*) from datasets") === afterFirst && !(await text()).includes("already been imported"));
check("scenario not listed as imported", !(await page.$$eval(".setup select optgroup", (gs) => gs.map((g) => g.label))).includes("Imported datasets"));
// 8b. Own upload twice → second rejected
const mine = join(mkdtempSync(join(tmpdir(), "smoke-")), "mine.csv");
writeFileSync(mine, "date,company,amount\n2026-08-01,Acme Test,-12.34\n2026-08-02,Client Test,99.00\n");
const up = async () => { const input = await page.$("#csv-file"); await input.uploadFile(mine);
  await page.waitForFunction(() => document.body.innerText.includes("Ready:")); await run(); };
await up();
const afterUpload = sql("select count(*) from datasets");
check("own upload listed as imported", (await page.$$eval(".setup select optgroup", (gs) => gs.map((g) => g.label))).includes("Imported datasets"));
await up();
check("duplicate upload rejected with message", (await text()).includes("already been imported"));
check("duplicate upload: no success notice", !(await page.$(".banner.success")));
check("duplicate upload stored nothing", sql("select count(*) from datasets") === afterUpload);
// 8c. Changing source hides results
await select("sample:small-business");
check("source change hides results", (await page.$$(".stat")).length === 0 && !(await page.$(".history")));

// 8d. Review filters match API
await run();
const sb = (await api("/datasets/small-business/load", { method: "POST" })).dataset_id;
const n = async (q) => (await api(`/datasets/${sb}/transactions${q}`)).length;
const shown = () => page.$$eval("table.transactions tbody tr", (r) => r.length);
const clickText = (sel, t) => page.evaluate((sel, t) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(t)).click(), sel, t);
check("filters in a labelled panel", !!(await page.$(".filter-panel[aria-label='Filter transactions'] .filter-title")));
await clickText(".segmented button", "Incoming"); await sleep(500);
check("direction filter = API", (await shown()) === await n("?direction=INCOMING"));
check("active filter count = 1", (await page.$eval(".filter-count", (e) => e.textContent)) === "1");
await page.select("select.filter-select", "Sales"); await sleep(500);
check("direction+category = API", (await shown()) === await n("?direction=INCOMING&category=Sales"));
await clickText(".filter-clear", "Clear all"); await sleep(500);
check("clear all resets", !(await page.$(".filter-count")) && (await shown()) === await n(""));
await clickText(".chip", "Needs review"); await sleep(500);
check("needs review filter = API", (await shown()) === await n("?category=uncategorised"));
check("needs review chip count = API", (await page.$eval(".chip-count", (e) => e.textContent)) === String(await n("?category=uncategorised")));
await clickText(".filter-clear", "Clear all"); await sleep(400);

// 8e. Backend error handling: FastAPI-style text 500 vs Vite-proxy empty 500
await page.setRequestInterception(true);
const fake500 = (r) => (r.method() === "PATCH" ? r.respond({ status: 500, contentType: "text/plain", body: "Internal Server Error" }) : r.continue());
page.on("request", fake500);
const rr = (await page.$$("tr.needs-review"))[0];
await (await rr.$("select")).select((await rr.$eval("td:nth-child(4)", (td) => td.textContent)) === "Expense" ? "Supplies" : "Sales");
await (await rr.$("button")).click();
await page.waitForSelector(".row-error");
const e500 = await page.$eval(".row-error", (e) => e.textContent);
check("text 500 → server error, outcome not confirmed", e500.startsWith("Save not confirmed") && e500.includes("server encountered an error (500)"), e500);
check("text 500 → no raw body shown", !e500.includes("Internal Server Error"));
page.off("request", fake500);
await page.setRequestInterception(false);
const p3 = await page.browser().newPage();
await p3.setRequestInterception(true);
p3.on("request", (r) => (r.url().includes("/api/datasets") ? r.respond({ status: 500, contentType: "text/plain", body: "" }) : r.continue()));
await p3.goto(URL, { waitUntil: "networkidle0" });
check("empty proxy 500 → cannot reach server", (await p3.evaluate(() => document.body.innerText)).includes("Cannot reach the server"));
await p3.close();
check("no date inputs", (await page.$$("input[type=date]")).length === 0);

// 11. How It Works
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => b.textContent === "How It Works").click());
await sleep(400);
await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
const hiw = await text();
check("HIW renders 6 sections", (await page.$$(".hiw-section")).length === 6);
check("HIW has SVG diagram", !!(await page.$("svg.diagram")));
const badges = await page.$$eval(".hiw-section", (ss) => ss.map((s) => s.querySelector("h2").textContent + "=" + s.querySelector(".badge").textContent));
console.log("   badges:", badges.join(" | "));
const openapi = await api("/openapi.json");
// fixed: the path pattern excludes trailing punctuation
const eps = [...hiw.matchAll(/(GET|POST|PATCH) (\/[^\s·,.;)]+)/g)].map((m) => [m[1], m[2].replace(/\/datasets\/\d+\//, "/datasets/{dataset_id}/").replace("SB-005", "{transaction_id}")]);
const missing = eps.filter(([m, p]) => !openapi.paths[p] || !openapi.paths[p][m.toLowerCase()]);
check("HIW endpoints exist in OpenAPI", missing.length === 0, JSON.stringify(missing));
const live = await api(`/datasets/${sb}/summary`);
console.log("   live small-business:", live.total_income_cents, live.total_expenses_cents, live.net_cents, live.uncategorised_count, "dataset_id", sb);
check("HIW example totals = live small-business", hiw.includes(String(live.total_income_cents)) && hiw.includes(String(live.total_expenses_cents)) && hiw.includes(String(live.net_cents)));
check("HIW example summary_text = live", hiw.includes(live.summary_text));
check("HIW verification text simple, no stale count", hiw.includes("GitHub Actions runs the same script") && !hiw.includes("128"));
check("HIW no unsupported 'deliberate bugs' claim", !/deliberate/i.test(hiw));
check("HIW agent pattern: only AI step marked future", hiw.includes("one narrow task")
  && JSON.stringify(await page.$$eval("#next .pipeline span", (s) => s.map((x) => x.className))) === JSON.stringify(["done", "", "done", "done", "done"]));
check("HIW diagram simplified (HTTP/JSON label, 4 boxes)", await page.$eval("svg.diagram", (s) => s.textContent.includes("HTTP/JSON") && s.querySelectorAll("rect.d-box").length === 4));
check("HIW logging statement mentions transaction IDs", hiw.includes("paths can contain transaction IDs"));
check("HIW not-implemented card distinct", !!(await page.$(".mini.gap")));
await page.setViewport({ width: 390, height: 844 }); await page.reload({ waitUntil: "networkidle0" });
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => b.textContent === "How It Works").click()); await sleep(400);
check("HIW no overflow at 390px", await page.evaluate(() => document.documentElement.scrollWidth <= 390));
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => b.textContent === "Insights").click()); await sleep(300);

// 9. Backend unavailable: fresh page with all /api requests failing
const p2 = await browser.newPage();
await p2.setRequestInterception(true);
p2.on("request", (r) => (r.url().includes("/api/") ? r.abort() : r.continue()));
await p2.goto(URL, { waitUntil: "networkidle0" });
const t9 = await p2.evaluate(() => document.body.innerText);
check("backend down: readable error", t9.includes("Cannot reach the server"));
check("backend down: no figures", (await p2.$$(".stat")).length === 0);

// 10. Mobile width: no horizontal overflow
await sleep(300);
check("no overflow at 390px", await page.evaluate(() => document.documentElement.scrollWidth <= 390));

check("no console errors (excluding aborted requests)",
  consoleErrors.filter((e) => !e.includes("ERR_FAILED") && !e.includes("Failed to load resource")).length === 0,
  JSON.stringify(consoleErrors));
console.log(`== ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
