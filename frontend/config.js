const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const isProdStaticWebApp =
  /jolly-glacier-058386a00\.1\.azurestaticapps\.net$/i.test(
    window.location.hostname
  );
const isDevStaticWebApp =
  /polite-bush-02b1f0c00\.2\.azurestaticapps\.net$/i.test(
    window.location.hostname
  );
const origin = window.location.origin;

window.portalConfig = {
  auth: {
    clientId: "3e5a0abe-cdfc-49de-9f3b-43d85f70b760",
    authority:
      "https://prithuconnect.ciamlogin.com/e80df615-7ecc-4b6e-8580-8b23c608ed9c",
    knownAuthorities: ["prithuconnect.ciamlogin.com"],
    redirectUri: isLocalHost
      ? "http://localhost:3000/index.html"
      : `${origin}/index.html`,
    popupRedirectUri: isLocalHost
      ? "http://localhost:3000/auth-callback.html"
      : `${origin}/auth-callback.html`,
  },
  api: {
    scope: "api://8cce258e-5182-48a8-851d-87825f0343fe/access_as_user",
    endpoint: isLocalHost
      ? "http://localhost:7071/api/customer/projects"
      : isProdStaticWebApp
      ? "https://prithu-customer-api-prod-gmebh9htgpf7ehb6.centralindia-01.azurewebsites.net/api/customer/projects"
      : isDevStaticWebApp
      ? "https://prithu-customer-api-ctfehbhkgpbaanf9.centralindia-01.azurewebsites.net/api/customer/projects"
      : "https://prithu-customer-api-ctfehbhkgpbaanf9.centralindia-01.azurewebsites.net/api/customer/projects",
  },
};
