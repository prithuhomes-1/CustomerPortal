window.portalConfig = {
  auth: {
    // Prithu Connect (Entra External ID) SPA app registration client ID.
    clientId: "<prithu-connect-spa-client-id>",
    // B2C authority must include the user flow/policy.
    authority: "https://prithuconnect.b2clogin.com/prithuconnect.onmicrosoft.com/B2C_1_SignUpSignIn",
    knownAuthorities: ["prithuconnect.b2clogin.com"],
    // Keep this exact URL registered in Entra External ID app registration.
    redirectUri: window.location.origin + window.location.pathname,
    popupRedirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, "auth-callback.html")
  },
  api: {
    // Exposed API scope from the external API app registration.
    scope: "api://<external-api-client-id>/access_as_user",
    endpoint: "http://localhost:7071/api/customer/projects"
  }
};
