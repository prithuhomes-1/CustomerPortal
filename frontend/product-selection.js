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
  title: document.getElementById("ps-title"),
  subtitle: document.getElementById("ps-subtitle"),
  categoryLabel: document.getElementById("label-category"),
  spaceCategoryLabel: document.getElementById("label-space-category"),
  productSetLabel: document.getElementById("label-product-set"),
  categorySelect: document.getElementById("filter-category"),
  spaceCategorySelect: document.getElementById("filter-space-category"),
  productSetSelect: document.getElementById("filter-product-set"),
  compareBtn: document.getElementById("compare-btn"),
  status: document.getElementById("ps-status"),
  cards: document.getElementById("ps-cards"),
  errorPanel: document.getElementById("error-panel"),
  errorView: document.getElementById("error-view"),
  footerText: document.getElementById("footer-text")
};

let content = null;
let msalClient = null;
let redirectPromise = null;
let hasProductAccess = false;
const dataState = {
  productSets: [],
  productSetItems: [],
  productMasters: []
};

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeNavHref(href) {
  const value = String(href || "").trim();
  if (!value.startsWith("#")) {
    return value || "#";
  }
  return `index.html${value}`;
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
  renderNav();
}

function renderNav() {
  const links = content.navigation?.links ?? [];
  const signedIn = !!(msalClient && (msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0]));
  ui.navLinks.innerHTML = "";
  links.forEach((link) => {
    if (link?.requiresProductAccess && (!signedIn || !hasProductAccess)) {
      return;
    }

    const a = document.createElement("a");
    a.href = normalizeNavHref(link.href || "#");
    a.textContent = link.label || "";
    ui.navLinks.appendChild(a);
  });
}

function clearError() {
  ui.errorPanel.classList.add("hidden");
  ui.errorView.textContent = "";
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
  ui.errorView.textContent = `${code ? `[${code}] ` : ""}${message || "Unexpected error occurred."}${details ? ` (${details})` : ""}${payload}`;
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

async function fetchEntityPayload(entity, token) {
  const endpoint = buildEntityEndpoint(entity);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : {};
  if (!response.ok) {
    throw { status: response.status, payload };
  }
  return payload;
}

function getFieldName(path, fallback) {
  const value = text(path, fallback);
  return String(value || fallback);
}

function getFormattedChoice(record, logicalName) {
  const formattedKey = `${logicalName}@OData.Community.Display.V1.FormattedValue`;
  return record?.[formattedKey] ?? record?.[logicalName] ?? "";
}

function getDistinctOptions(rows, valueKey, labelResolver) {
  const map = new Map();
  rows.forEach((row) => {
    const value = String(getFieldValue(row, valueKey) ?? "");
    if (!value) {
      return;
    }
    if (!map.has(value)) {
      map.set(value, String(labelResolver(row) || value));
    }
  });
  return [...map.entries()].map(([value, label]) => ({ value, label }));
}

function getFieldValue(record, logicalName) {
  if (!record || !logicalName) {
    return "";
  }

  const raw = record[logicalName];
  if (raw !== null && raw !== undefined && String(raw) !== "") {
    return raw;
  }

  const formatted = record[`${logicalName}@OData.Community.Display.V1.FormattedValue`];
  return formatted ?? "";
}

function setSelectOptions(selectEl, options, allLabel) {
  selectEl.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  selectEl.appendChild(allOption);

  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    selectEl.appendChild(option);
  });
}

function applyFilters() {
  const allLabel = text("productSelection.filters.allOption", "All");
  const categoryField = getFieldName("productSelection.fields.category", "sgr_category");
  const spaceCategoryField = getFieldName("productSelection.fields.spaceCategory", "sgr_spacecategory");
  const productSetIdField = getFieldName("productSelection.fields.productSetId", "sgr_productsetid");
  const productSetNameField = getFieldName("productSelection.fields.productSetName", "sgr_name");

  let categoryOptions = getDistinctOptions(
    dataState.productSets,
    categoryField,
    (row) => getFormattedChoice(row, categoryField)
  );
  if (categoryOptions.length === 0 && categoryField !== "sgr_spacetype") {
    categoryOptions = getDistinctOptions(
      dataState.productSets,
      "sgr_spacetype",
      (row) => getFormattedChoice(row, "sgr_spacetype")
    );
  }

  const prevCategory = ui.categorySelect.value;
  setSelectOptions(ui.categorySelect, categoryOptions, allLabel);
  ui.categorySelect.value = categoryOptions.some((x) => x.value === prevCategory) ? prevCategory : "";

  const selectedCategory = ui.categorySelect.value;
  const effectiveCategoryField = categoryOptions.length > 0 && categoryField === "sgr_category"
    ? (getDistinctOptions(dataState.productSets, categoryField, (row) => getFormattedChoice(row, categoryField)).length > 0 ? categoryField : "sgr_spacetype")
    : categoryField;
  const categoryFiltered = selectedCategory
    ? dataState.productSets.filter((row) => String(getFieldValue(row, effectiveCategoryField)) === selectedCategory)
    : dataState.productSets;

  const spaceOptions = getDistinctOptions(
    categoryFiltered,
    spaceCategoryField,
    (row) => getFormattedChoice(row, spaceCategoryField)
  );
  const prevSpace = ui.spaceCategorySelect.value;
  setSelectOptions(ui.spaceCategorySelect, spaceOptions, allLabel);
  ui.spaceCategorySelect.value = spaceOptions.some((x) => x.value === prevSpace) ? prevSpace : "";

  const selectedSpace = ui.spaceCategorySelect.value;
  const setFiltered = selectedSpace
    ? categoryFiltered.filter((row) => String(getFieldValue(row, spaceCategoryField)) === selectedSpace)
    : categoryFiltered;

  const setOptions = getDistinctOptions(
    setFiltered,
    productSetIdField,
    (row) => row?.[productSetNameField]
  );
  const prevSet = ui.productSetSelect.value;
  setSelectOptions(ui.productSetSelect, setOptions, allLabel);
  ui.productSetSelect.value = setOptions.some((x) => x.value === prevSet) ? prevSet : "";

  renderCards();
}

function renderCards() {
  const selectedSetId = ui.productSetSelect.value;
  const itemSetLookup = getFieldName("productSelection.fields.itemProductSetLookup", "_sgr_productset_value");
  const itemMasterLookup = getFieldName("productSelection.fields.itemProductMasterLookup", "_sgr_productmaster_value");
  const masterIdField = getFieldName("productSelection.fields.masterId", "sgr_productmasterid");
  const imageField = getFieldName("productSelection.cards.imageField", "sgr_imageurl");
  const imageAlt = text("productSelection.cards.imageAlt", "Product image");
  const fields = content?.productSelection?.cards?.fields ?? [];

  const candidateItems = selectedSetId
    ? dataState.productSetItems.filter((row) => String(row?.[itemSetLookup] ?? "") === selectedSetId)
    : [];
  const mastersById = new Map(
    dataState.productMasters.map((row) => [String(row?.[masterIdField] ?? ""), row])
  );
  const cards = candidateItems
    .map((item) => mastersById.get(String(item?.[itemMasterLookup] ?? "")))
    .filter(Boolean);

  if (cards.length === 0) {
    ui.status.textContent = text("productSelection.messages.noData", "No product records available for selected filters.");
    ui.cards.innerHTML = "";
    return;
  }

  ui.status.textContent = `${cards.length} products loaded.`;
  ui.cards.innerHTML = cards.map((card) => {
    const imageUrl = String(card?.[imageField] ?? "").trim();
    const rows = fields.map((field) => {
      const value = card?.[field.key] ?? "-";
      return `<div class="product-card-row"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }).join("");

    return `
      <article class="product-card">
        <div class="product-card-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" />` : ""}</div>
        <div class="product-card-body">${rows}</div>
      </article>
    `;
  }).join("");
}

async function loadSelectionData() {
  clearError();
  ui.status.textContent = text("productSelection.messages.loading", "Loading product selection data...");
  ui.cards.innerHTML = "";
  const token = await getAccessToken();

  const productAccessEntityKey = text("productSelection.actions.productAccessEntityKey", "productaccess");
  const accessPayload = await fetchEntityPayload(productAccessEntityKey, token);
  hasProductAccess = accessPayload?.hasAccess === true;
  renderNav();
  if (!hasProductAccess) {
    ui.status.textContent = text("productSelection.messages.notAuthorized", "Product Selection is available only for users with eligible projects.");
    return;
  }

  const selectionEntityKey = text("productSelection.actions.productSelectionEntityKey", "productselection");
  const payload = await fetchEntityPayload(selectionEntityKey, token);
  dataState.productSets = Array.isArray(payload?.productSets) ? payload.productSets : [];
  dataState.productSetItems = Array.isArray(payload?.productSetItems) ? payload.productSetItems : [];
  dataState.productMasters = Array.isArray(payload?.productMasters) ? payload.productMasters : [];
  applyFilters();
}

async function login() {
  clearError();
  if (!msalClient) {
    throw new Error("Authentication is not configured. Update frontend/config.js with Prithu Connect app details.");
  }

  const loginRequest = { scopes: [config.api.scope], authority: config.auth.authority, redirectUri: popupRedirectUri };
  const response = await msalClient.loginPopup(loginRequest);
  msalClient.setActiveAccount(response.account);
  setAuthState(response.account);
  await loadSelectionData();
}

async function logout() {
  clearError();
  if (!msalClient) {
    setAuthState(null);
    return;
  }
  const account = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (account) {
    await msalClient.logoutPopup({ account, mainWindowRedirectUri: config.auth.redirectUri });
  }
  hasProductAccess = false;
  setAuthState(null);
  ui.status.textContent = text("messages.noSignedInAccount", "Please sign in first.");
  ui.cards.innerHTML = "";
}

function applyStaticContent() {
  document.title = `${text("productSelection.title", "Product Selection")} | ${text("site.title", "Customer Portal")}`;
  ui.brandLink.href = text("brand.link", "#");
  ui.brandLogo.src = text("brand.brandLogoUrl", "");
  ui.brandLogo.alt = text("brand.brandLogoAlt", "");
  ui.appLogo.src = text("brand.appLogoUrl", "");
  ui.appLogo.alt = text("brand.appLogoAlt", "");
  ui.loginBtn.textContent = text("auth.login", "Login");
  ui.signupBtn.textContent = text("auth.signup", "Sign Up");
  ui.logoutBtn.textContent = text("auth.logout", "Logout");
  ui.title.textContent = text("productSelection.title", "Product Set Selection");
  ui.subtitle.textContent = text("productSelection.subtitle", "");
  ui.categoryLabel.textContent = text("productSelection.filters.category", "Category");
  ui.spaceCategoryLabel.textContent = text("productSelection.filters.spaceCategory", "Space Category");
  ui.productSetLabel.textContent = text("productSelection.filters.productSet", "Product Set");
  ui.compareBtn.textContent = text("productSelection.filters.compareCta", "Add Set To Compare");
  ui.footerText.textContent = text("footer.text", "");
  ui.status.textContent = text("messages.noSignedInAccount", "Please sign in first.");
}

function wireEvents() {
  ui.hamburger.addEventListener("click", () => ui.navbar.classList.toggle("mobile-open"));
  ui.loginBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await login(); } catch (err) { showError(err); } });
  ui.signupBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await login(); } catch (err) { showError(err); } });
  ui.logoutBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await logout(); } catch (err) { showError(err); } });
  ui.categorySelect.addEventListener("change", applyFilters);
  ui.spaceCategorySelect.addEventListener("change", applyFilters);
  ui.productSetSelect.addEventListener("change", renderCards);
  ui.compareBtn.addEventListener("click", renderCards);
}

function initializeMsal() {
  if (!window.msal?.PublicClientApplication) {
    showError("MSAL library failed to load.");
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

async function initializeAuthState() {
  if (!msalClient || !redirectPromise) {
    setAuthState(null);
    return;
  }

  const response = await redirectPromise;
  if (response?.account) {
    msalClient.setActiveAccount(response.account);
    setAuthState(response.account);
    await loadSelectionData();
    return;
  }

  const current = msalClient.getActiveAccount() ?? msalClient.getAllAccounts()[0];
  if (current) {
    msalClient.setActiveAccount(current);
    setAuthState(current);
    await loadSelectionData();
  } else {
    hasProductAccess = false;
    setAuthState(null);
  }
}

async function bootstrap() {
  const response = await fetch(CONTENT_PATH, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load content.json (${response.status}).`);
  }
  content = await response.json();
  applyStaticContent();
  renderNav();
  wireEvents();
  initializeMsal();
  await initializeAuthState();
}

bootstrap().catch(showError);
