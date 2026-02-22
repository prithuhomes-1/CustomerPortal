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
  addCompareBtn: document.getElementById("add-compare-btn"),
  runCompareBtn: document.getElementById("run-compare-btn"),
  clearCompareBtn: document.getElementById("clear-compare-btn"),
  selectedSetsLabel: document.getElementById("selected-sets-label"),
  selectedSetsChips: document.getElementById("selected-sets-chips"),
  compareResults: document.getElementById("compare-results"),
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
const compareState = {
  selectedSetIds: [],
  maxSets: 3
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

function getDisplayFieldValue(record, fieldKey) {
  if (!record || !fieldKey) {
    return "-";
  }

  if (fieldKey.includes("@")) {
    const value = record[fieldKey];
    return value === null || value === undefined || value === "" ? "-" : value;
  }

  const formatted = record[`${fieldKey}@OData.Community.Display.V1.FormattedValue`];
  if (formatted !== null && formatted !== undefined && String(formatted) !== "") {
    return formatted;
  }

  const raw = record[fieldKey];
  return raw === null || raw === undefined || raw === "" ? "-" : raw;
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

function normalizeImageUrls(card) {
  const configuredImageFields = content?.productSelection?.cards?.imageFields;
  const fallbackField = getFieldName("productSelection.cards.imageField", "sgr_productimage");
  const fields = Array.isArray(configuredImageFields) && configuredImageFields.length > 0
    ? configuredImageFields
    : [fallbackField];

  const urls = fields
    .map((field) => String(card?.[field] ?? "").trim())
    .filter((url) => url.length > 0);

  return [...new Set(urls)];
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

function getSetNameById(setId) {
  const productSetIdField = getFieldName("productSelection.fields.productSetId", "sgr_productsetid");
  const productSetNameField = getFieldName("productSelection.fields.productSetName", "sgr_name");
  const row = dataState.productSets.find((x) => String(x?.[productSetIdField] ?? "") === String(setId));
  return row?.[productSetNameField] ?? setId;
}

function getSetRecordById(setId) {
  const productSetIdField = getFieldName("productSelection.fields.productSetId", "sgr_productsetid");
  return dataState.productSets.find((x) => String(x?.[productSetIdField] ?? "") === String(setId)) ?? null;
}

function getProductsForSet(setId) {
  const itemSetLookup = getFieldName("productSelection.fields.itemProductSetLookup", "_sgr_productset_value");
  const itemMasterLookup = getFieldName("productSelection.fields.itemProductMasterLookup", "_sgr_product_value");
  const masterIdField = getFieldName("productSelection.fields.masterId", "sgr_productmasterid");
  const mastersById = new Map(dataState.productMasters.map((row) => [String(row?.[masterIdField] ?? ""), row]));

  return dataState.productSetItems
    .filter((row) => String(row?.[itemSetLookup] ?? "") === String(setId))
    .map((item) => mastersById.get(String(item?.[itemMasterLookup] ?? "")))
    .filter(Boolean);
}

function renderCompareChips() {
  const label = text("productSelection.compare.selectedCount", "{count} model sets selected (max {max})")
    .replace("{count}", String(compareState.selectedSetIds.length))
    .replace("{max}", String(compareState.maxSets));
  ui.selectedSetsLabel.textContent = label;

  ui.selectedSetsChips.innerHTML = compareState.selectedSetIds.map((setId) => {
    const name = getSetNameById(setId);
    return `<button class="compare-chip" type="button" data-set-id="${escapeHtml(setId)}">${escapeHtml(name)} <span aria-hidden="true">x</span></button>`;
  }).join("");
}

function addCurrentSetToCompare() {
  const setId = ui.productSetSelect.value;
  if (!setId) {
    ui.status.textContent = text("productSelection.messages.pickSetFirst", "Select a Product Set first.");
    return;
  }

  if (compareState.selectedSetIds.includes(setId)) {
    ui.status.textContent = text("productSelection.messages.alreadyAdded", "This Product Set is already added for comparison.");
    return;
  }

  if (compareState.selectedSetIds.length >= compareState.maxSets) {
    ui.status.textContent = text("productSelection.messages.maxReached", "Maximum compare limit reached.");
    return;
  }

  compareState.selectedSetIds.push(setId);
  renderCompareChips();
  ui.status.textContent = text("productSelection.messages.added", "Product Set added for comparison.");
}

function clearCompareSelection() {
  compareState.selectedSetIds = [];
  ui.compareResults.innerHTML = "";
  ui.compareResults.classList.add("hidden");
  renderCompareChips();
}

function renderCompareResults() {
  if (compareState.selectedSetIds.length === 0) {
    ui.status.textContent = text("productSelection.messages.comparePick", "Add at least one Product Set to compare.");
    return;
  }

  const productSetNameField = getFieldName("productSelection.fields.productSetName", "sgr_name");
  const categoryField = getFieldName("productSelection.fields.category", "sgr_category");
  const spaceCategoryField = getFieldName("productSelection.fields.spaceCategory", "sgr_spacecategory");
  const imageAlt = text("productSelection.cards.imageAlt", "Product image");

  const columnsHtml = compareState.selectedSetIds.map((setId) => {
    const setRecord = getSetRecordById(setId);
    const products = getProductsForSet(setId);
    const productRows = products.map((product) => {
      const img = normalizeImageUrls(product)[0] ?? "";
      const name = getDisplayFieldValue(product, "sgr_name");
      const make = getDisplayFieldValue(product, "_sgr_make_value@OData.Community.Display.V1.FormattedValue");
      const code = getDisplayFieldValue(product, "sgr_productcode");

      return `
        <article class="compare-product-card">
          <div class="compare-product-media">${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(imageAlt)}" />` : ""}</div>
          <div class="compare-product-meta">
            <strong>${escapeHtml(name)}</strong>
            <span>Brand: ${escapeHtml(make)}</span>
            <span>Code: ${escapeHtml(code)}</span>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="compare-column">
        <header class="compare-column-head">
          <h3>${escapeHtml(setRecord?.[productSetNameField] ?? setId)}</h3>
          <p>Category: ${escapeHtml(getDisplayFieldValue(setRecord, categoryField))}</p>
          <p>Space: ${escapeHtml(getDisplayFieldValue(setRecord, spaceCategoryField))}</p>
        </header>
        <div class="compare-column-body">${productRows}</div>
      </section>
    `;
  }).join("");

  ui.compareResults.innerHTML = `
    <div class="compare-results-title">${escapeHtml(text("productSelection.compare.resultsTitle", "Model Set Comparison"))}</div>
    <div class="compare-grid">${columnsHtml}</div>
  `;
  ui.compareResults.classList.remove("hidden");
}

function renderCards() {
  const selectedSetId = ui.productSetSelect.value;
  const itemSetLookup = getFieldName("productSelection.fields.itemProductSetLookup", "_sgr_productset_value");
  const itemMasterLookup = getFieldName("productSelection.fields.itemProductMasterLookup", "_sgr_product_value");
  const masterIdField = getFieldName("productSelection.fields.masterId", "sgr_productmasterid");
  const imageAlt = text("productSelection.cards.imageAlt", "Product image");
  const fields = content?.productSelection?.cards?.fields ?? [];

  const candidateItems = selectedSetId
    ? dataState.productSetItems.filter((row) => String(row?.[itemSetLookup] ?? "") === selectedSetId)
    : [];
  const mastersById = new Map(dataState.productMasters.map((row) => [String(row?.[masterIdField] ?? ""), row]));
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
    const images = normalizeImageUrls(card);
    const imageUrl = images.length > 0 ? images[0] : "";
    const rows = fields.map((field) => {
      const value = getDisplayFieldValue(card, field.key);
      return `<div class="product-card-row"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }).join("");

    const hasCarousel = images.length > 1;
    const dots = images.map((_, idx) => `<span class="product-card-dot${idx === 0 ? " active" : ""}"></span>`).join("");

    return `
      <article class="product-card zoom-right" data-image-index="0" data-images='${escapeHtml(JSON.stringify(images))}'>
        <div class="product-card-image-wrap">
          <div class="product-card-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" />` : ""}</div>
          <div class="product-card-zoom">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" />` : ""}</div>
          ${hasCarousel ? `<button class="product-card-nav prev" type="button" aria-label="Previous image">&#10094;</button>` : ""}
          ${hasCarousel ? `<button class="product-card-nav next" type="button" aria-label="Next image">&#10095;</button>` : ""}
          ${hasCarousel ? `<div class="product-card-dots">${dots}</div>` : ""}
        </div>
        <div class="product-card-body">${rows}</div>
      </article>
    `;
  }).join("");
}

function updateCardImage(cardEl, nextIndex) {
  const imagesRaw = cardEl.getAttribute("data-images") || "[]";
  const images = JSON.parse(imagesRaw);
  if (!Array.isArray(images) || images.length === 0) {
    return;
  }

  const normalizedIndex = ((nextIndex % images.length) + images.length) % images.length;
  cardEl.setAttribute("data-image-index", String(normalizedIndex));
  const nextUrl = images[normalizedIndex];

  const mainImg = cardEl.querySelector(".product-card-image img");
  const zoomImg = cardEl.querySelector(".product-card-zoom img");
  if (mainImg) {
    mainImg.src = nextUrl;
  }
  if (zoomImg) {
    zoomImg.src = nextUrl;
  }

  const dots = cardEl.querySelectorAll(".product-card-dot");
  dots.forEach((dot, index) => {
    dot.classList.toggle("active", index === normalizedIndex);
  });
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
  clearCompareSelection();
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
  clearCompareSelection();
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
  ui.addCompareBtn.textContent = text("productSelection.filters.compareCta", "Add Set To Compare");
  ui.runCompareBtn.textContent = text("productSelection.compare.runButton", "Compare");
  ui.clearCompareBtn.textContent = text("productSelection.compare.clearButton", "Clear");
  ui.footerText.textContent = text("footer.text", "");
  ui.status.textContent = text("messages.noSignedInAccount", "Please sign in first.");
  renderCompareChips();
}

function wireEvents() {
  ui.hamburger.addEventListener("click", () => ui.navbar.classList.toggle("mobile-open"));
  ui.loginBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await login(); } catch (err) { showError(err); } });
  ui.signupBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await login(); } catch (err) { showError(err); } });
  ui.logoutBtn.addEventListener("click", async (e) => { e.preventDefault(); try { await logout(); } catch (err) { showError(err); } });
  ui.categorySelect.addEventListener("change", applyFilters);
  ui.spaceCategorySelect.addEventListener("change", applyFilters);
  ui.productSetSelect.addEventListener("change", renderCards);
  ui.addCompareBtn.addEventListener("click", addCurrentSetToCompare);
  ui.runCompareBtn.addEventListener("click", renderCompareResults);
  ui.clearCompareBtn.addEventListener("click", clearCompareSelection);

  ui.selectedSetsChips.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const chip = target.closest(".compare-chip");
    if (!(chip instanceof HTMLElement)) {
      return;
    }

    const setId = chip.getAttribute("data-set-id");
    if (!setId) {
      return;
    }

    compareState.selectedSetIds = compareState.selectedSetIds.filter((x) => x !== setId);
    renderCompareChips();
  });

  ui.cards.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest(".product-card-nav");
    if (!button) {
      return;
    }

    const cardEl = target.closest(".product-card");
    if (!(cardEl instanceof HTMLElement)) {
      return;
    }

    const current = Number(cardEl.getAttribute("data-image-index") || "0");
    const delta = button.classList.contains("next") ? 1 : -1;
    updateCardImage(cardEl, current + delta);
  });

  ui.cards.addEventListener("mouseenter", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const cardEl = target.closest(".product-card");
    if (!(cardEl instanceof HTMLElement)) {
      return;
    }

    const rect = cardEl.getBoundingClientRect();
    const cardMidX = rect.left + (rect.width / 2);
    const shouldOpenLeft = cardMidX > (window.innerWidth / 2);
    cardEl.classList.toggle("zoom-left", shouldOpenLeft);
    cardEl.classList.toggle("zoom-right", !shouldOpenLeft);
  }, true);
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
