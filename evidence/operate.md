# Operate

Local, single-user demo. Not production-ready. "Proposed" = not built.

## Run
| Task | Command |
|------|---------|
| Backend | `cd backend && source .venv/bin/activate && uvicorn main:app --reload` (port 8000) |
| Frontend | `cd frontend && npm run dev` → http://localhost:5173 |
| Verify | `./verify.sh` |
| Liveness | `curl localhost:8000/health` → `{"status":"ok"}`: the process answers (no DB check) |
| Readiness | `curl localhost:8000/ready` → 200 `{"status":"ready"}`, or 503 `{"status":"unavailable"}` if the DB can't be opened or lacks its tables |
| Browser smoke (optional) | `scripts/browser-smoke/run.sh`: see [verify.md](verify.md) |

- Setup and prerequisites: [README](../README.md).
- Data lives in `backend/transaction_insights.db` (SQLite, git-ignored).
- Vite proxies `/api/*` to port 8000. No config files, credentials or paid services.

## Logs
- The app writes no log lines of its own. Uvicorn access logs show method, path and status; paths can include dataset and transaction IDs.
- Request bodies (CSV contents, amounts, company names) are not logged by the app or the access log.
- Unhandled exceptions are logged with a traceback by Uvicorn. Their messages are not redacted and could include a field value; this hasn't been audited for every error.
- **Proposed:** structured logs with request IDs, redaction of exception messages and IDs, metrics, alerts on errors and readiness failures.

## Failure modes
| Failure | What happens | Fix |
|---------|--------------|-----|
| Backend down | "Cannot reach the server" | Start the backend |
| Invalid CSV / missing column | Row errors; nothing stored | Fix the file |
| Unknown headers | Asks for a column mapping | Map the columns |
| Duplicate file | Rejected (409); nothing stored | Choose the existing dataset |
| Invalid category / unknown transaction | Confirmed rejection (422/404): "Not saved"; no change, no audit row | Pick an approved category |
| Save with no reply (network lost, 5xx) | Outcome unknown: the server may have committed before the reply was lost. UI says "could not confirm" and reloads | Check the reloaded row; save again if needed (same category twice = one audit row) |
| Amount over $1,000,000,000.00 | Row error; nothing stored | Fix the file |
| Database locked or unwritable | "Server encountered an error"; change rolled back | Check the backend log and file permissions; restart |

## Audit trail
- Records dataset ID, transaction ID, previous and new category, and UTC timestamp. Committed atomically with the update.
- A basic application audit trail: **not** compliance-grade or tamper-evident. Anyone with file access can edit the DB.
- **Proposed (enterprise):** authenticated actor, tenant ownership, authorisation checks, correlation IDs, change reason where required, restricted append-only storage, retention and privacy policies.

## Reset and backup
Stop the backend first.
```bash
cp backend/transaction_insights.db backup.db   # backup
rm backend/transaction_insights.db             # reset (recreated empty on start)
```
⚠️ Resetting deletes all imported datasets and review history.

## Production (proposed)
**Promotion path:** pull request → tests and security checks → code review → versioned build → staging → smoke tests → approval → production → monitoring and rollback.

- **Today:** GitHub Actions runs `./verify.sh`. It verifies; it does not deploy.
- **Releases:** one immutable versioned build promoted through each environment; roll back by redeploying the previous version.
- **Database:** managed PostgreSQL, automated backups, migrations compatible with the previous release.
- **Hosting:** static frontend on a CDN; API on a managed host behind TLS, rate limits and upload size limits.
- **Access:** OIDC sign-in, per-user datasets, secrets in a secrets manager.
