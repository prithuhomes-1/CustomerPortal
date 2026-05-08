const PortalComponents = (() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function attrs(attributes = {}) {
    return Object.entries(attributes)
      .filter(([, value]) => value !== false && value !== null && value !== undefined)
      .map(([key, value]) => (value === true ? key : `${key}="${escapeHtml(value)}"`))
      .join(" ");
  }

  function navbar() {
    return `
      <nav class="navbar">
        <div class="nav-container">
          <div class="brand-wrap">
            <a href="#" id="brand-link" class="logo">
              <img id="brand-logo" src="" alt="" />
            </a>
            <a href="./index.html" aria-label="Go to home page">
              <img id="app-logo" src="" alt="" class="app-logo" />
            </a>
          </div>
          <div id="nav-links" class="nav-links"></div>
          <div class="nav-auth">
            <div id="guest-area" class="inline-row">
              <a href="#" id="login-btn" class="btn-text"></a>
              <a href="#" id="signup-btn" class="btn btn-primary"></a>
            </div>
            <div id="user-area" class="hidden inline-row">
              <span id="user-name" class="user-name"></span>
              <a href="#" id="logout-btn" class="btn-text"></a>
            </div>
          </div>
          <div class="hamburger" id="hamburger"><span></span><span></span><span></span></div>
        </div>
      </nav>
    `;
  }

  function footer() {
    return `
      <footer>
        <div class="container footer-meta">
          <p id="footer-text"></p>
          <p id="footer-credit"></p>
        </div>
      </footer>
    `;
  }

  function sidebar({ id = "", title = "", links = [] } = {}) {
    const linkHtml = links
      .map((link) => `<a href="${escapeHtml(link.href || "#")}">${escapeHtml(link.label || "")}</a>`)
      .join("");

    return `
      <aside ${attrs({ id, class: "portal-sidebar" })}>
        ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
        <nav>${linkHtml}</nav>
      </aside>
    `;
  }

  function card({ href = "", imageUrl = "", imageAlt = "", badge = "", title = "", body = "", className = "" } = {}) {
    const media = imageUrl || badge
      ? `<div class="card-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt || title)}" />` : ""}${badge ? `<span class="card-badge">${escapeHtml(badge)}</span>` : ""}</div>`
      : "";
    const article = `
      <article class="card ${escapeHtml(className)}">
        ${media}
        <div class="card-body">
          ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
          ${body ? `<p>${escapeHtml(body)}</p>` : ""}
        </div>
      </article>
    `;

    return href ? `<a class="card-link" href="${escapeHtml(href)}">${article}</a>` : article;
  }

  function table({ columns = [], rows = [], className = "glass-table", includeRank = false } = {}) {
    const rankHead = includeRank ? `<th class="rank-col">#</th>` : "";
    const head = columns.map((column) => `<th>${escapeHtml(column.label || column.key || "")}</th>`).join("");
    const body = rows
      .map((row, index) => {
        const rankCell = includeRank ? `<td class="rank-col">${index + 1}</td>` : "";
        const cells = columns
          .map((column) => {
            const value = row?.[column.key];
            return `<td>${escapeHtml(value === null || value === undefined || value === "" ? "-" : value)}</td>`;
          })
          .join("");
        return `<tr>${rankCell}${cells}</tr>`;
      })
      .join("");

    return `<table class="${escapeHtml(className)}"><thead><tr>${rankHead}${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function button({ id = "", label = "", variant = "primary", type = "button", className = "", disabled = false } = {}) {
    return `<button ${attrs({ id, type, disabled, class: `btn btn-${variant} ${className}` })}>${escapeHtml(label)}</button>`;
  }

  function input({ id = "", name = "", label = "", value = "", type = "text", placeholder = "", required = false } = {}) {
    return `
      <label class="form-field" ${id ? `for="${escapeHtml(id)}"` : ""}>
        ${label ? `<span>${escapeHtml(label)}</span>` : ""}
        <input ${attrs({ id, name, type, value, placeholder, required })} />
      </label>
    `;
  }

  function loader({ text = "Loading..." } = {}) {
    return `<div class="portal-loader" role="status"><span></span>${escapeHtml(text)}</div>`;
  }

  function modal({ id = "portal-modal", title = "", body = "", confirmLabel = "Confirm", cancelLabel = "Cancel" } = {}) {
    return `
      <div id="${escapeHtml(id)}" class="portal-modal hidden" role="dialog" aria-modal="true">
        <div class="portal-modal-panel">
          ${title ? `<h2>${escapeHtml(title)}</h2>` : ""}
          <div class="portal-modal-body">${body}</div>
          <div class="portal-modal-actions">
            ${button({ label: cancelLabel, variant: "outline", className: "portal-modal-cancel" })}
            ${button({ label: confirmLabel, variant: "primary", className: "portal-modal-confirm" })}
          </div>
        </div>
      </div>
    `;
  }

  function ensureToastRoot() {
    let root = document.getElementById("portal-toast-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "portal-toast-root";
      root.className = "portal-toast-root";
      document.body.appendChild(root);
    }
    return root;
  }

  function toast(message, { variant = "info", duration = 3500 } = {}) {
    const root = ensureToastRoot();
    const item = document.createElement("div");
    item.className = `portal-toast portal-toast-${variant}`;
    item.textContent = message;
    root.appendChild(item);
    window.setTimeout(() => item.remove(), duration);
    return item;
  }

  function renderPageComponents() {
    document.querySelectorAll("[data-portal-component='navbar']").forEach((node) => {
      node.outerHTML = navbar();
    });
    document.querySelectorAll("[data-portal-component='footer']").forEach((node) => {
      node.outerHTML = footer();
    });
  }

  renderPageComponents();

  return {
    button,
    card,
    escapeHtml,
    footer,
    input,
    loader,
    modal,
    navbar,
    renderPageComponents,
    sidebar,
    table,
    toast
  };
})();

window.PortalComponents = PortalComponents;
