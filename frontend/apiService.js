const PortalApiService = (() => {
  function assertConfig(config) {
    if (!config?.api?.endpoint) {
      throw new Error("Missing API endpoint. Check frontend/config.js.");
    }
  }

  function buildEntityEndpoint(config, entity) {
    assertConfig(config);

    if (entity === "projects") {
      return config.api.endpoint;
    }

    if (config.api.dataEndpoint) {
      return `${config.api.dataEndpoint}?entity=${encodeURIComponent(entity)}`;
    }

    if (config.api.endpoint.includes("/api/customer/projects")) {
      return config.api.endpoint.replace(
        "/api/customer/projects",
        `/api/customer/data?entity=${encodeURIComponent(entity)}`
      );
    }

    return config.api.endpoint;
  }

  async function parseResponse(response, emptyValue) {
    const body = await response.text();
    const payload = body ? JSON.parse(body) : emptyValue;

    if (!response.ok) {
      throw {
        status: response.status,
        statusText: response.statusText,
        payload
      };
    }

    return payload;
  }

  function create({ config, getAccessToken }) {
    assertConfig(config);

    async function getEntity(entity, { emptyValue = [] } = {}) {
      const token = await getAccessToken();
      const response = await fetch(buildEntityEndpoint(config, entity), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });

      return parseResponse(response, emptyValue);
    }

    async function postEntity(entity, payload, { emptyValue = {} } = {}) {
      const token = await getAccessToken();
      const response = await fetch(buildEntityEndpoint(config, entity), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      return parseResponse(response, emptyValue);
    }

    return {
      buildEntityEndpoint: (entity) => buildEntityEndpoint(config, entity),
      getEntity,
      postEntity
    };
  }

  return {
    buildEntityEndpoint,
    create
  };
})();

window.PortalApiService = PortalApiService;
