# Frontend (Customer Portal)

This folder contains a minimal static frontend for the customer portal.

## Files
- `index.html`: UI shell.
- `data-view.html`: section-wise tabular view of `content.json`.
- `content.json`: centralized static content for frontend pages.
- `config.js`: frontend runtime config placeholders.
- `app.js`: MSAL sign-in and backend API call logic.
- `data-view.js`: renderer for `data-view.html`.
- `styles.css`: responsive styling.

## Configure
Update `frontend/config.js` values:
- `<external-spa-client-id>`
- `<external-tenant>`
- `<policy>`
- `<external-api-client-id>`
- `api.endpoint`

Update all page text in `frontend/content.json`.

## Run locally
From repo root:

```powershell
cd frontend
python -m http.server 5500
```

Open: `http://localhost:5500`
