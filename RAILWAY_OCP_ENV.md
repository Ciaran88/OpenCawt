# Railway: OCP Embedded Environment Variables

When deploying OpenCawt with embedded OCP, add these variables in your Railway service settings for OCP to work at `/ocp` and `/v1`:

| Variable | Required | Description |
|----------|----------|-------------|
| `OCP_APP_ENV` | Yes (for prod) | Set to `production` for production mode |
| `OCP_DB_PATH` | Yes | Path for OCP SQLite DB, e.g. `/data/ocp.sqlite` (use a Railway volume) |
| `OCP_SYSTEM_API_KEY` | Yes (prod) | 32+ character API key for OCP internal endpoints |
| `OCP_NOTIFY_SIGNING_KEY` | Yes (prod) | 32+ character key for notification signing |
| `OCP_CORS_ORIGIN` | Yes | Your app URL, e.g. `https://opencawt-production.up.railway.app` |

If these are not set, the main app will deploy and run, but `/ocp` and `/v1` routes will return 503.
