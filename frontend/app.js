const CONTENT_PATH = "./content.json";

const config = window.portalConfig;
if (!config) {
  throw new Error("Missing frontend config. Check frontend/config.js.");
}

const popupRedirectUri = config.auth.popupRedirectUri || new URL("auth-callback.html", window.location.href).href;

const ui = {
  navbar: document.querySelector(".navbar"),
  hamburger: document.getElementById("hamburger"),
  brandLink: document.getElementById("brand-link"),
  brandLogo: document.getElementById("brand-logo"),
  appLogo: document.getElementById("app-logo"),
  navLinks: document.getElementById("nav-links"),
  guestArea: document.getElementById("guest-area"),
  userArea: document.getElementById("user-area"),
  loginBtn: document.getElementById("login-btn"),
  signupBtn: document.getElementById("signup-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  userName: document.getElementById("user-name"),
  heroVideo: document.getElementById("hero-video"),
  heroTitle: document.getElementById("hero-title"),
  heroSubtitle: document.getElementById("hero-subtitle"),
  primaryCta: document.getElementById("primary-cta"),
  secondaryCta: document.getElementById("secondary-cta"),
  featuresTitle: document.getElementById("features-title"),
  featuresSubtitle: document.getElementById("features-subtitle"),
  featureGrid: document.getElementById("feature-grid"),
  projectsTitle: document.getElementById("projects-title"),
  projectsSubtitle: document.getElementById("projects-subtitle"),
  loadProjectsBtn: document.getElementById("load-projects-btn"),
  loadAgreementsBtn: document.getElementById("load-agreements-btn"),
  loadMilestonesBtn: document.getElementById("load-milestones-btn"),
  loadTransactionsBtn: document.getElementById("load-transactions-btn"),
  loadProjectspacesBtn: document.getElementById("load-projectspaces-btn"),
  loadProjectsLabel: document.getElementById("load-projects-label"),
  loadAgreementsLabel: document.getElementById("load-agreements-label"),
  loadMilestonesLabel: document.getElementById("load-milestones-label"),
  loadTransactionsLabel: document.getElementById("load-transactions-label"),
  loadProjectspacesLabel: document.getElementById("load-projectspaces-label"),
  projectsView: document.getElementById("projects-view"),
  errorPanel: document.getElementById("error-panel"),
  errorView: document.getElementById("error-view"),
  footerText: document.getElementById("footer-text")
};

let content = null;
let msalClient = null;
let redirectPromise = null;
let activeDataTab = "projects";
const dataCache = {
  projects: null,
  agreements: null,
  milestones: null,
  transactions: null,
  projectspaces: null,
  loaded: false,
  loading: false
};

function isPlaceholder(value) {
  const str = String(value || "").trim();
  return str.includes("<") || str.includes(">");
}

function text(path, fallback = "") {
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

function normalizeNavHref(href) {
  const value = String(href || "").trim();
  if (!value.startsWith("#")) {
    return value || "#";
  }

  const page = (window.location.pathname.split("/").pop() || "").toLowerCase();
  const isHomePage = page === "" || page === "index.html";
  return isHomePage ? value : `index.html${value}`;
}

function setAuthState(account) {
  if (account) {
    ui.guestArea.classList.add("hidden");
    ui.userArea.classList.remove("hidden");
    ui.userName.textContent = `Hi, ${account.name || account.username || text("auth.defaultUserName", "Customer")}`;
  } else {
    ui.guestArea.classList.remove("hidden");
    ui.userArea.classList.add("hidden");
    ui.userName.textContent = "";
  }
}

function renderNav() {
  const links = content.navigation?.links ?? [];
  ui.navLinks.innerHTML = "";
  links.forEach((link) => {
    const a = document.createElement("a");
    a.href = normalizeNavHref(link.href || "#");
    a.textContent = link.label || "";
    ui.navLinks.appendChild(a);
  });
}

function renderFeatures() {
  const cards = content.features?.cards ?? [];
  ui.featureGrid.innerHTML = "";
  cards.forEach((card) => {
    const anchor = document.createElement("a");
    anchor.className = "card-link";
    anchor.href = card.href || "#";

    const image = card.imageUrl
      ? `<div class="card-image"><img src="${card.imageUrl}" alt="${card.title || ""}" /><span class="card-badge">${card.badge || ""}</span></div>`
      : `<div class="card-image"><span class="card-badge">${card.badge || ""}</span></div>`;

    anchor.innerHTML = `
      <article class="card">
        ${image}
        <div class="card-body">
          <h3>${card.title || ""}</h3>
          <p>${card.description || ""}</p>
        </div>
      </article>
    `;
    ui.featureGrid.appendChild(anchor);
  });
}

function applyContent() {
  document.title = text("site.title", "Customer Portal");
  ui.brandLink.href = text("brand.link", "#");
  ui.brandLogo.src = text("brand.brandLogoUrl", "");
  ui.brandLogo.alt = text("brand.brandLogoAlt", "");
  ui.appLogo.src = text("brand.appLogoUrl", "");
  ui.appLogo.alt = text("brand.appLogoAlt", "");

  ui.loginBtn.textContent = text("auth.login", "Login");
  ui.signupBtn.textContent = text("auth.signup", "Sign Up");
  ui.logoutBtn.textContent = text("auth.logout", "Logout");

  ui.heroTitle.textContent = text("hero.title", "");
  ui.heroSubtitle.textContent = text("hero.subtitle", "");
  ui.primaryCta.textContent = text("hero.primaryCta", "Explore");
  ui.secondaryCta.textContent = text("hero.secondaryCta", "Load Projects");

  ui.featuresTitle.textContent = text("features.title", "");
  ui.featuresSubtitle.textContent = text("features.subtitle", "");
  ui.projectsTitle.textContent = text("projects.title", "Projects");
  ui.projectsSubtitle.textContent = text("projects.subtitle", "");
  ui.loadProjectsLabel.textContent = text("projects.actions.loadProjects", "Load Projects");
  ui.loadAgreementsLabel.textContent = text("projects.actions.loadAgreements", "Load Agreements");
  ui.loadMilestonesLabel.textContent = text("projects.actions.loadMilestones", "Load Milestones");
  ui.loadTransactionsLabel.textContent = text("projects.actions.loadTransactions", "Load Transactions");
  ui.loadProjectspacesLabel.textContent = text("projects.actions.loadProjectSpaces", "Load Project Spaces");
  ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(text("projects.placeholders.default", "No project data loaded."))}</p>`;
  ui.footerText.textContent = text("footer.text", "");

  const videoUrl = text("hero.videoUrl", "");
  if (videoUrl) {
    ui.heroVideo.src = videoUrl;
    ui.heroVideo.load();
    ui.heroVideo.play().catch(() => {});
  }

  renderNav();
  renderFeatures();
}

function showError(err) {
  ui.errorPanel.classList.remove("hidden");
  if (typeof err === "string") {
    ui.errorView.textContent = err;
    return;
  }

  const message = err?.message || err?.errorMessage || "";
  const code = err?.errorCode || err?.code || "";
  const details = err?.subError || err?.name || "";
  const payload = err?.payload ? `\nPayload: ${JSON.stringify(err.payload, null, 2)}` : "";

  ui.errorView.textContent =
    `${code ? `[${code}] ` : ""}${message || "Unexpected error occurred."}${details ? ` (${details})` : ""}${payload}`;
}

function clearError() {
  ui.errorPanel.classList.add("hidden");
  ui.errorView.textContent = "";
}

function getSectionConfig(tabKey) {
  return content?.projects?.sections?.[tabKey] ?? {};
}

function getFieldConfig(tabKey) {
  return content?.projects?.displayFields?.[tabKey] ?? [];
}

function getSortConfig(tabKey) {
  return content?.projects?.sort?.[tabKey] ?? null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDataTable(tabKey, records) {
  const section = getSectionConfig(tabKey);
  const fieldConfig = getFieldConfig(tabKey);
  const sortConfig = getSortConfig(tabKey);
  const title = section.title || tabKey;
  const subtitle = section.subtitle || "";

  ui.projectsSubtitle.textContent = subtitle;

  if (!Array.isArray(records) || records.length === 0) {
    const emptyText = section.emptyText || text("projects.placeholders.default", "No project data loaded.");
    ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const fields = Array.isArray(fieldConfig) && fieldConfig.length > 0
    ? fieldConfig
    : Object.keys(records[0]).map((key) => ({ key, label: key }));

  let rowsData = [...records];
  if (sortConfig?.key) {
    const direction = String(sortConfig.direction || "asc").toLowerCase() === "desc" ? -1 : 1;
    const key = sortConfig.key;
    const type = String(sortConfig.type || "string").toLowerCase();

    rowsData.sort((a, b) => {
      const av = a?.[key];
      const bv = b?.[key];

      if (type === "date") {
        const at = Date.parse(String(av || ""));
        const bt = Date.parse(String(bv || ""));
        const safeA = Number.isNaN(at) ? 0 : at;
        const safeB = Number.isNaN(bt) ? 0 : bt;
        return (safeA - safeB) * direction;
      }

      if (type === "number") {
        const an = Number(av ?? 0);
        const bn = Number(bv ?? 0);
        return (an - bn) * direction;
      }

      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return as.localeCompare(bs) * direction;
    });
  }

  const headCells = fields
    .map((field) => `<th>${escapeHtml(field.label || field.key)}</th>`)
    .join("");

  const rows = rowsData
    .map((record, index) => {
      const cells = fields
        .map((field) => {
          const raw = record[field.key];
          const value = raw === null || raw === undefined || raw === "" ? "-" : raw;
          return `<td>${escapeHtml(value)}</td>`;
        })
        .join("");
      return `<tr><td class="rank-col">${index + 1}</td>${cells}</tr>`;
    })
    .join("");

  ui.projectsView.innerHTML = `
    <div class="glass-wrap">
      <div class="glass-caption">${escapeHtml(title)}</div>
      <table class="glass-table">
        <thead><tr><th class="rank-col">#</th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setActiveTab(entity) {
  activeDataTab = entity;
  const mappings = [
    { key: "projects", button: ui.loadProjectsBtn },
    { key: "agreements", button: ui.loadAgreementsBtn },
    { key: "milestones", button: ui.loadMilestonesBtn },
    { key: "transactions", button: ui.loadTransactionsBtn },
    { key: "projectspaces", button: ui.loadProjectspacesBtn }
  ];

  mappings.forEach(({ key, button }) => {
    const isActive = key === entity;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

async function login() {
  clearError();
  if (!msalClient) {
    throw new Error("Authentication is not configured. Update frontend/config.js with Prithu Connect app details.");
  }

  const loginRequest = {
    scopes: [config.api.scope]
  };

  if (config.auth.authority) {
    loginRequest.authority = config.auth.authority;
  }

  loginRequest.redirectUri = popupRedirectUri;
  try {
    const response = await msalClient.loginPopup(loginRequest);
    msalClient.setActiveAccount(response.account);
    setAuthState(response.account);
  } catch (err) {
    const message = String(err?.message || err || "");
    if (
      message.toLowerCase().includes("popup") ||
      message.toLowerCase().includes("blocked")
    ) {
      await msalClient.loginRedirect({
        ...loginRequest,
        redirectUri: config.auth.redirectUri
      });
      return;
    }
    throw err;
  }
}

async function logout() {
  clearError();
  if (!msalClient) {
    setAuthState(null);
    return;
  }

  const account = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (!account) {
    setAuthState(null);
    return;
  }

  await msalClient.logoutPopup({
    account,
    mainWindowRedirectUri: config.auth.redirectUri
  });
  setAuthState(null);
  dataCache.projects = null;
  dataCache.agreements = null;
  dataCache.milestones = null;
  dataCache.transactions = null;
  dataCache.projectspaces = null;
  dataCache.loaded = false;
  dataCache.loading = false;
  setActiveTab("projects");
  ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(text("projects.placeholders.default", "No project data loaded."))}</p>`;
}

async function getAccessToken() {
  if (!msalClient) {
    throw new Error("Authentication is not configured. Update frontend/config.js with Prithu Connect app details.");
  }

  const account = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (!account) {
    throw new Error(text("messages.noSignedInAccount", "Please sign in first."));
  }

  const request = {
    account,
    scopes: [config.api.scope],
    authority: config.auth.authority
  };

  try {
    const result = await msalClient.acquireTokenSilent(request);
    return result.accessToken;
  } catch {
    const result = await msalClient.acquireTokenPopup({ ...request, redirectUri: popupRedirectUri });
    return result.accessToken;
  }
}

function buildEntityEndpoint(entity) {
  if (config.api?.dataEndpoint) {
    return `${config.api.dataEndpoint}?entity=${encodeURIComponent(entity)}`;
  }

  if (config.api?.endpoint && config.api.endpoint.includes("/api/customer/projects")) {
    return config.api.endpoint.replace("/api/customer/projects", `/api/customer/data?entity=${encodeURIComponent(entity)}`);
  }

  return config.api.endpoint;
}

async function fetchEntityPayload(entity, token) {
  const endpoint = entity === "projects" ? config.api.endpoint : buildEntityEndpoint(entity);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : [];

  if (!response.ok) {
    throw { status: response.status, payload };
  }

  return payload;
}

function renderActiveData() {
  const value =
    activeDataTab === "projects"
      ? dataCache.projects
      : activeDataTab === "agreements"
        ? dataCache.agreements
        : activeDataTab === "milestones"
          ? dataCache.milestones
          : activeDataTab === "transactions"
            ? dataCache.transactions
            : dataCache.projectspaces;

  if (value === null) {
    ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(text("projects.placeholders.loadProjectsFirst", "Click Project Details to load all sections."))}</p>`;
    return;
  }

  renderDataTable(activeDataTab, value);
}

async function loadAllProjectData() {
  if (dataCache.loading) {
    return;
  }

  clearError();
  dataCache.loading = true;
  ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(text("projects.placeholders.loadingAll", "Loading project details, agreements, milestones, transactions, and project spaces..."))}</p>`;

  try {
    const token = await getAccessToken();
    const agreementsEntityKey = text("projects.actions.agreementsEntityKey", "customeragreements");
    const milestonesEntityKey = text("projects.actions.milestonesEntityKey", "paymentmilestones");
    const transactionsEntityKey = text("projects.actions.transactionsEntityKey", "paymenttransactions");
    const projectSpacesEntityKey = text("projects.actions.projectSpacesEntityKey", "projectspaces");

    const [projects, agreements, milestones, transactions, projectspaces] = await Promise.all([
      fetchEntityPayload("projects", token),
      fetchEntityPayload(agreementsEntityKey, token),
      fetchEntityPayload(milestonesEntityKey, token),
      fetchEntityPayload(transactionsEntityKey, token),
      fetchEntityPayload(projectSpacesEntityKey, token)
    ]);

    dataCache.projects = projects;
    dataCache.agreements = agreements;
    dataCache.milestones = milestones;
    dataCache.transactions = transactions;
    dataCache.projectspaces = projectspaces;
    dataCache.loaded = true;
    renderActiveData();
    document.getElementById("projects").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    ui.projectsView.innerHTML = `<p class="table-empty">${escapeHtml(text("projects.placeholders.default", "No project data loaded."))}</p>`;
    showError(err);
  } finally {
    dataCache.loading = false;
  }
}

async function loadProjects() {
  setActiveTab("projects");
  if (!dataCache.loaded) {
    await loadAllProjectData();
    return;
  }

  renderActiveData();
}

async function loadAgreements() {
  setActiveTab("agreements");
  renderActiveData();
}

async function loadMilestones() {
  setActiveTab("milestones");
  renderActiveData();
}

async function loadTransactions() {
  setActiveTab("transactions");
  renderActiveData();
}

async function loadProjectSpaces() {
  setActiveTab("projectspaces");
  renderActiveData();
}

function wireEvents() {
  ui.hamburger.addEventListener("click", () => {
    ui.navbar.classList.toggle("mobile-open");
  });

  ui.loginBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await login();
    } catch (err) {
      showError(err);
    }
  });

  ui.signupBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await login();
    } catch (err) {
      showError(err);
    }
  });

  ui.logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await logout();
    } catch (err) {
      showError(err);
    }
  });

  ui.primaryCta.addEventListener("click", () => {
    document.getElementById("trainings").scrollIntoView({ behavior: "smooth" });
  });

  ui.secondaryCta.addEventListener("click", async () => {
    try {
      await loadProjects();
    } catch (err) {
      showError(err);
      document.getElementById("projects").scrollIntoView({ behavior: "smooth" });
    }
  });

  ui.loadProjectsBtn.addEventListener("click", async () => {
    try {
      await loadProjects();
    } catch (err) {
      showError(err);
    }
  });

  ui.loadAgreementsBtn.addEventListener("click", async () => {
    try {
      await loadAgreements();
    } catch (err) {
      showError(err);
    }
  });

  ui.loadMilestonesBtn.addEventListener("click", async () => {
    try {
      await loadMilestones();
    } catch (err) {
      showError(err);
    }
  });

  ui.loadTransactionsBtn.addEventListener("click", async () => {
    try {
      await loadTransactions();
    } catch (err) {
      showError(err);
    }
  });

  ui.loadProjectspacesBtn.addEventListener("click", async () => {
    try {
      await loadProjectSpaces();
    } catch (err) {
      showError(err);
    }
  });
}

async function initializeAuthState() {
  if (!msalClient || !redirectPromise) {
    setAuthState(null);
    return;
  }

  const response = await redirectPromise;
  if (response?.account) {
    msalClient.setActiveAccount(response.account);
    setAuthState(response.account);
    return;
  }

  const current = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (current) {
    msalClient.setActiveAccount(current);
    setAuthState(current);
  } else {
    setAuthState(null);
  }
}

function initializeMsal() {
  if (!window.msal?.PublicClientApplication) {
    showError("MSAL library failed to load.");
    return;
  }

  if (
    !config.auth?.clientId ||
    !config.auth?.authority ||
    isPlaceholder(config.auth.clientId) ||
    isPlaceholder(config.auth.authority) ||
    isPlaceholder(config.api?.scope)
  ) {
    showError("Configure frontend/config.js with real Prithu Connect clientId, authority, and API scope.");
    setAuthState(null);
    return;
  }

  const msalConfig = {
    auth: {
      clientId: config.auth.clientId,
      authority: config.auth.authority,
      knownAuthorities: config.auth.knownAuthorities,
      redirectUri: config.auth.redirectUri
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false
    }
  };

  msalClient = new msal.PublicClientApplication(msalConfig);
  redirectPromise = msalClient.handleRedirectPromise();
}

async function bootstrap() {
  const response = await fetch(CONTENT_PATH, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load content.json (${response.status}).`);
  }

  content = await response.json();
  applyContent();
  setActiveTab("projects");
  wireEvents();
  initializeMsal();
  await initializeAuthState();
}

bootstrap().catch(showError);
