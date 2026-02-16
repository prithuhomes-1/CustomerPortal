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
  projectsView: document.getElementById("projects-view"),
  errorPanel: document.getElementById("error-panel"),
  errorView: document.getElementById("error-view"),
  footerText: document.getElementById("footer-text")
};

let content = null;
let msalClient = null;
let redirectPromise = null;

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
  ui.projectsView.textContent = text("projects.placeholders.default", "No project data loaded.");
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
  ui.errorView.textContent = typeof err === "string" ? err : JSON.stringify(err, null, 2);
}

function clearError() {
  ui.errorPanel.classList.add("hidden");
  ui.errorView.textContent = "";
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

  const response = await msalClient.loginPopup(loginRequest);
  msalClient.setActiveAccount(response.account);
  setAuthState(response.account);
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
  ui.projectsView.textContent = text("projects.placeholders.default", "No project data loaded.");
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

async function loadProjects() {
  clearError();
  ui.projectsView.textContent = text("projects.placeholders.loading", "Loading...");
  try {
    const token = await getAccessToken();
    const response = await fetch(config.api.endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.text();
    const payload = body ? JSON.parse(body) : [];

    if (!response.ok) {
      throw { status: response.status, payload };
    }

    ui.projectsView.textContent = JSON.stringify(payload, null, 2);
    document.getElementById("projects").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    ui.projectsView.textContent = text("projects.placeholders.default", "No project data loaded.");
    showError(err);
  }
}

function wireEvents() {
  ui.hamburger.addEventListener("click", () => {
    ui.navbar.classList.toggle("mobile-open");
  });

  ui.loginBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await login();
  });

  ui.signupBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await login();
  });

  ui.logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await logout();
  });

  ui.primaryCta.addEventListener("click", () => {
    document.getElementById("trainings").scrollIntoView({ behavior: "smooth" });
  });

  ui.secondaryCta.addEventListener("click", async () => {
    await loadProjects();
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
  wireEvents();
  initializeMsal();
  await initializeAuthState();
}

bootstrap().catch(showError);
