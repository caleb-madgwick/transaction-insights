# Operate

Local, single-user demo. Not production-ready. "Proposed" = not built.

## Run
| Task | Command |
|------|---------|
| Backend | `cd backend && source .venv/bin/activate && uvicorn main:app --reload` (port 8000) |
| Frontend | `cd frontend && npm run dev` → http://localhost:5173 |
| Verify | `./verify.sh` |
| Health | `curl localhost:8000/health` → `{"status":"ok"}` |

- Setup and prerequisites: [README](../README.md).
- Data lives in `backend/transaction_insights.db` (SQLite, git-ignored).
- Vite proxies `/api/*` to port 8000. No config files, credentials or paid services.

## Logs
- Uvicorn logs method, path and status. Paths can include transaction IDs.
- Never logged: CSV contents, amounts, company names.
- **Proposed:** structured logs with request IDs, metrics, alerts on errors and health failures.

## Failure modes
| Failure | What happens | Fix |
|---------|--------------|-----|
| Backend down | "Cannot reach the server" | Start the backend |
| Invalid CSV / missing column | Row errors; nothing stored | Fix the file |
| Unknown headers | Asks for a column mapping | Map the columns |
| Duplicate file | Rejected (409); nothing stored | Choose the existing dataset |
| Invalid category | Rejected (422); no change | Pick an approved category |
| Failed save | "Not saved"; no audit row | Retry |
| Database locked or unwritable | "Server encountered an error"; change rolled back | Check the backend log and file permissions; restart |

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
