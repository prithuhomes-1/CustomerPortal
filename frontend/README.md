# Frontend (Customer Portal)

This folder contains a minimal static frontend for the customer portal.

## Files
- `index.html`: UI shell.
- `data-view.html`: section-wise tabular view of `content.json`.
- `content.json`: centralized static content for frontend pages.
- `config.js`: frontend runtime config placeholders.
- `components.js`: reusable HTML component helpers and shared navbar/footer shell.
- `apiService.js`: shared API endpoint builder and token-aware GET/POST service.
- `app.js`: MSAL sign-in and backend API call logic.
- `data-view.js`: renderer for `data-view.html`.
- `styles.css`: responsive styling.

## Reusable Components
`components.js` exposes `window.PortalComponents` for shared UI building blocks:

- `navbar()` / `footer()` render the shared portal shell from `<div data-portal-component="navbar"></div>` and `<div data-portal-component="footer"></div>`.
- `sidebar({ title, links })`
- `card({ href, imageUrl, badge, title, body })`
- `table({ columns, rows, className, includeRank })`
- `modal({ title, body, confirmLabel, cancelLabel })`
- `loader({ text })`
- `toast(message, { variant })`
- `button({ label, variant })`
- `input({ label, name, type, value })`

## API Service Layer
`apiService.js` exposes `window.PortalApiService` so page scripts do not repeat fetch logic.

```javascript
const apiService = PortalApiService.create({ config, getAccessToken });
const projects = await apiService.getEntity("projects");
const spaces = await apiService.getEntity("projectspaces");
await apiService.postEntity("projectspaceselection", payload);
```

The service owns:
- `/api/customer/projects` vs `/api/customer/data?entity=...` URL selection.
- Authorization header wiring.
- JSON parsing.
- Consistent error payloads for debugging.

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
