const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

window.portalConfig = {
  auth: {
    clientId: "3e5a0abe-cdfc-49de-9f3b-43d85f70b760",
    authority:
      "https://prithuconnect.b2clogin.com/prithuconnect.onmicrosoft.com/B2C_1_SignUpSignIn",
    knownAuthorities: ["prithuconnect.b2clogin.com"],
    redirectUri:
      "https://prithuhomes-1.github.io/CustomerPortal/frontend/index.html",
    popupRedirectUri:
      "https://prithuhomes-1.github.io/CustomerPortal/frontend/auth-callback.html",
  },
  api: {
    scope: "api://8cce258e-5182-48a8-851d-87825f0343fe/access_as_user",
    endpoint: isLocalHost
      ? "http://localhost:7071/api/customer/projects"
      : "https://prithu-customer-api-ctfehbhkgpbaanf9.centralindia-01.azurewebsites.net/api/customer/projects",
  },
};
