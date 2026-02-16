const loginBtn = document.getElementById("loginBtn");
const loadBtn = document.getElementById("loadBtn");
const logoutBtn = document.getElementById("logoutBtn");
const sessionView = document.getElementById("sessionView");
const projectsView = document.getElementById("projectsView");
const errorPanel = document.getElementById("errorPanel");
const errorView = document.getElementById("errorView");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const dataViewLink = document.getElementById("dataViewLink");
const sessionHeading = document.getElementById("sessionHeading");
const projectsHeading = document.getElementById("projectsHeading");
const errorHeading = document.getElementById("errorHeading");
const CONTENT_PATH = "./content.json";

let content = null;

function getContentValue(path, fallback = "") {
  if (!content) {
    return fallback;
  }

  const keys = path.split(".");
  let current = content;

  for (const key of keys) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }

  return typeof current === "string" ? current : fallback;
}

const config = window.portalConfig;
if (!config) {
  throw new Error("Missing frontend config. Check frontend/config.js.");
}

const msalClient = new msal.PublicClientApplication({
  auth: config.auth,
  cache: {
    cacheLocation: "sessionStorage"
  }
});

function applyStaticContent() {
  document.title = getContentValue("index.pageTitle", "Customer Portal");
  pageTitle.textContent = getContentValue("index.pageTitle", "Customer Portal");
  pageSubtitle.textContent = getContentValue("index.pageSubtitle", "");
  dataViewLink.textContent = getContentValue("index.links.dataView", "Data View");
  loginBtn.textContent = getContentValue("index.buttons.login", "Sign In");
  loadBtn.textContent = getContentValue("index.buttons.loadProjects", "Load Projects");
  logoutBtn.textContent = getContentValue("index.buttons.logout", "Sign Out");
  sessionHeading.textContent = getContentValue("index.sections.session", "Session");
  projectsHeading.textContent = getContentValue("index.sections.projects", "Projects");
  errorHeading.textContent = getContentValue("index.sections.error", "Error");
  sessionView.textContent = getContentValue("index.placeholders.noActiveSession", "No active session.");
  projectsView.textContent = getContentValue("index.placeholders.noDataLoaded", "No data loaded.");
}

function setSignedOut() {
  loadBtn.disabled = true;
  logoutBtn.disabled = true;
  sessionView.textContent = getContentValue("index.placeholders.noActiveSession", "No active session.");
}

function setSignedIn(account) {
  loadBtn.disabled = false;
  logoutBtn.disabled = false;
  sessionView.textContent = JSON.stringify(
    {
      username: account.username,
      tenantId: account.tenantId,
      homeAccountId: account.homeAccountId
    },
    null,
    2
  );
}

function showError(err) {
  errorPanel.hidden = false;
  errorView.textContent = typeof err === "string" ? err : JSON.stringify(err, null, 2);
}

function clearError() {
  errorPanel.hidden = true;
  errorView.textContent = "";
}

async function initializeSession() {
  const response = await msalClient.handleRedirectPromise();
  const account = response?.account ?? msalClient.getAllAccounts()[0];
  if (!account) {
    setSignedOut();
    return null;
  }

  msalClient.setActiveAccount(account);
  setSignedIn(account);
  return account;
}

async function login() {
  clearError();
  await msalClient.loginPopup({ scopes: [config.api.scope] });
  await initializeSession();
}

async function logout() {
  clearError();
  const account = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (account) {
    await msalClient.logoutPopup({ account });
  }
  setSignedOut();
  projectsView.textContent = getContentValue("index.placeholders.noDataLoaded", "No data loaded.");
}

async function getAccessToken() {
  const account = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (!account) {
    throw new Error(getContentValue("messages.noSignedInAccount", "No signed-in account available."));
  }

  const tokenRequest = {
    account,
    scopes: [config.api.scope]
  };

  try {
    const tokenResponse = await msalClient.acquireTokenSilent(tokenRequest);
    return tokenResponse.accessToken;
  } catch {
    const tokenResponse = await msalClient.acquireTokenPopup(tokenRequest);
    return tokenResponse.accessToken;
  }
}

async function loadProjects() {
  clearError();
  projectsView.textContent = getContentValue("index.placeholders.loading", "Loading...");

  try {
    const token = await getAccessToken();
    const response = await fetch(config.api.endpoint, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const text = await response.text();
    let payload;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw { status: response.status, payload };
    }

    projectsView.textContent = JSON.stringify(payload ?? [], null, 2);
  } catch (err) {
    projectsView.textContent = getContentValue("index.placeholders.noDataLoaded", "No data loaded.");
    showError(err);
  }
}

loginBtn.addEventListener("click", login);
loadBtn.addEventListener("click", loadProjects);
logoutBtn.addEventListener("click", logout);

async function bootstrap() {
  const response = await fetch(CONTENT_PATH, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load content.json (${response.status}).`);
  }

  content = await response.json();
  applyStaticContent();
  await initializeSession();
}

bootstrap().catch(showError);
