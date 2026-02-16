window.portalConfig = {
  auth: {
    clientId: "<external-spa-client-id>",
    authority: "https://<external-tenant>.b2clogin.com/<external-tenant>.onmicrosoft.com/<policy>",
    knownAuthorities: ["<external-tenant>.b2clogin.com"],
    redirectUri: window.location.origin + window.location.pathname
  },
  api: {
    scope: "api://<external-api-client-id>/access_as_user",
    endpoint: "http://localhost:7071/api/customer/projects"
  }
};
