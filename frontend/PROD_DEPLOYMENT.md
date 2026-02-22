# Production Hosting Plan

This keeps:
- Dev frontend on GitHub Pages (`main`)
- Prod frontend on Azure Static Web Apps (`prod`)

## 1) Azure resources

Create/confirm:
- Azure Static Web App (prod frontend)
- Azure Function App (already done): `prithu-customer-api-Prod`

## 2) Connect GitHub repo to Static Web App

In Azure Portal (Static Web App):
1. Deployment source: GitHub
2. Repository: `prithuhomes-1/CustomerPortal`
3. Branch: `prod`
4. Build preset: Custom
5. App location: `frontend`
6. Output location: leave blank

## 3) GitHub secret for deployment token

In GitHub repo:
1. Settings -> Secrets and variables -> Actions
2. Add secret:
   - Name: `AZURE_STATIC_WEB_APPS_API_TOKEN_PROD`
   - Value: Deployment token from Static Web App

## 4) Frontend prod config in `prod` branch

Update `frontend/config.js` for prod:
- `auth.redirectUri` -> your prod site `/index.html`
- `auth.popupRedirectUri` -> your prod site `/auth-callback.html`
- `api.endpoint` -> `https://prithu-customer-api-prod-gmebh9htgpf7ehb6.centralindia-01.azurewebsites.net/api/customer/projects`

## 5) Backend prod settings

In Function App `prithu-customer-api-Prod`:
- keep all required app settings
- prod values when ready (`Dataverse_Url`, secrets, etc.)
- CORS: add your prod frontend URL

## 6) Release flow

1. Merge `main` -> `prod`
2. Verify `frontend/config.js` in `prod`
3. Push `prod`
4. GitHub Action deploys Static Web App
5. Smoke test login + load projects

