const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const isGitHubPages = window.location.hostname.endsWith("github.io");
const computedRedirectUri = isLocalHost
  ? "http://localhost:3000"
  : new URL("index.html", window.location.href).href;
const computedPopupRedirectUri = isLocalHost
  ? "http://localhost:3000/auth-callback.html"
  : new URL("auth-callback.html", window.location.href).href;

window.portalConfig = {
  auth: {
    clientId: "3e5a0abe-cdfc-49de-9f3b-43d85f70b760",
    authority:
      "https://prithuconnect.ciamlogin.com/e80df615-7ecc-4b6e-8580-8b23c608ed9c",
    knownAuthorities: ["prithuconnect.ciamlogin.com"],
    redirectUri: computedRedirectUri,
    popupRedirectUri: computedPopupRedirectUri,
  },
  api: {
    scope: "api://8cce258e-5182-48a8-851d-87825f0343fe/access_as_user",
    endpoint: isLocalHost
      ? "http://localhost:7071/api/customer/projects"
      : isGitHubPages
      ? "https://prithu-customer-api-ctfehbhkgpbaanf9.centralindia-01.azurewebsites.net/api/customer/projects"
      : "https://prithu-customer-api-prod-gmebh9htgpf7ehb6.centralindia-01.azurewebsites.net/api/customer/projects",
  },
};
