using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Identity.Client;

public class GetCustomerProjects
{
    private readonly ILogger<GetCustomerProjects> _logger;
    private static readonly HttpClient _httpClient = new HttpClient();
    private static ConfigurationManager<OpenIdConnectConfiguration>? _oidcConfigurationManager;
    private static string? _oidcMetadataUrl;
    private static readonly object _oidcConfigLock = new object();

    public GetCustomerProjects(ILogger<GetCustomerProjects> logger)
    {
        _logger = logger;
    }

    [Function("GetCustomerProjects")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "customer/projects")] Microsoft.Azure.Functions.Worker.Http.HttpRequestData req)
    {
        return await HandleRequestAsync(req);
    }

    [Function("GetCustomerData")]
    public async Task<HttpResponseData> RunCustomerData([HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "customer/data")] Microsoft.Azure.Functions.Worker.Http.HttpRequestData req)
    {
        return await HandleRequestAsync(req);
    }

    private async Task<HttpResponseData> HandleRequestAsync(Microsoft.Azure.Functions.Worker.Http.HttpRequestData req)
    {
        try
        {
            if (!req.Headers.TryGetValues("Authorization", out var authHeaders))
            {
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Missing Authorization header.");
            }

            var authHeader = authHeaders.FirstOrDefault();
            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            {
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Authorization header must be a Bearer token.");
            }

            var token = authHeader.Substring("Bearer ".Length).Trim();

            var claimsPrincipal = await ValidateTokenAsync(token);
            if (claimsPrincipal == null)
            {
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Token validation failed.");
            }

            var requiredPortalRole = GetEnvironmentVariableOrDefault("External_RequiredRole", "customer_portal_access");
            if (!string.IsNullOrWhiteSpace(requiredPortalRole) && !HasRequiredRole(claimsPrincipal, requiredPortalRole))
            {
                _logger.LogWarning("Access denied. Required role missing. RequiredRole: {RequiredRole}", requiredPortalRole);
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Forbidden, $"User is authenticated but does not have required role '{requiredPortalRole}'.");
            }

            var oid = GetFirstClaimValue(
                claimsPrincipal,
                "oid",
                "http://schemas.microsoft.com/identity/claims/objectidentifier",
                "sub",
                ClaimTypes.NameIdentifier,
                "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier");
            var email = claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "email")?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "emails")?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "preferred_username")?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "upn")?.Value;

            if (string.IsNullOrEmpty(oid))
            {
                _logger.LogWarning("Token missing required identity claim. Expected one of: oid/objectidentifier/sub/nameidentifier.");
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Required token claims are missing.");
            }

            if (string.IsNullOrEmpty(email))
            {
                _logger.LogInformation("Token does not contain email-like claims. Will use OID-only contact lookup. OID: {OID}", oid);
            }

            var dataverseToken = await AcquireDataverseTokenAsync();
            if (string.IsNullOrEmpty(dataverseToken))
            {
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.InternalServerError, "Failed to acquire Dataverse access token.");
            }

            var contactId = await GetContactAsync(oid, email, dataverseToken);
            if (string.IsNullOrEmpty(contactId))
            {
                _logger.LogWarning("Authorized token but no matching customer contact found. OID: {OID}", oid);
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Forbidden, "User is authenticated but not authorized for customer data.");
            }

            var secondaryEntityKey = GetEnvironmentVariableOrDefault("Dataverse_SecondaryEntityKey", "related");
            var thirdEntityKey = GetEnvironmentVariableOrDefault("Dataverse_3rdEntityKey", "customeragreements");
            var fourthEntityKey = GetEnvironmentVariableOrDefault("Dataverse_4thEntityKey", "paymentmilestones");
            var fifthEntityKey = GetEnvironmentVariableOrDefault("Dataverse_5thEntityKey", "paymenttransactions");
            var sixthEntityKey = GetEnvironmentVariableOrDefault("Dataverse_6thEntityKey", "projectspaces");
            var productAccessEntityKey = GetEnvironmentVariableOrDefault("Dataverse_ProductAccessEntityKey", "productaccess");
            var productSelectionEntityKey = GetEnvironmentVariableOrDefault("Dataverse_ProductSelectionEntityKey", "productselection");
            var projectSpaceSubmitEntityKey = GetEnvironmentVariableOrDefault("Dataverse_ProjectSpaceSubmitEntityKey", "projectspaceselection");
            var requestedEntity = GetQueryParameter(req.Url, "entity");
            var entity = string.IsNullOrWhiteSpace(requestedEntity) ? "projects" : requestedEntity.Trim().ToLowerInvariant();
            var method = req.Method?.Trim().ToUpperInvariant() ?? "GET";

            string responseJson;
            if (method == "POST" && entity == projectSpaceSubmitEntityKey.ToLowerInvariant())
            {
                responseJson = await UpdateProjectSpaceSelectionAsync(req, contactId, dataverseToken);
            }
            else if (method != "GET")
            {
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.MethodNotAllowed, $"HTTP method '{method}' is not supported for entity '{entity}'.");
            }
            else if (entity == "projects")
            {
                responseJson = await GetProjectsAsync(contactId, dataverseToken);
            }
            else if (entity == secondaryEntityKey.ToLowerInvariant())
            {
                responseJson = await GetSecondaryEntityAsync(contactId, dataverseToken);
            }
            else if (entity == thirdEntityKey.ToLowerInvariant())
            {
                responseJson = await GetThirdTableAsync(contactId, dataverseToken);
            }
            else if (entity == fourthEntityKey.ToLowerInvariant())
            {
                responseJson = await GetFourthTableAsync(contactId, dataverseToken);
            }
            else if (entity == fifthEntityKey.ToLowerInvariant())
            {
                responseJson = await GetFifthTableAsync(contactId, dataverseToken);
            }
            else if (entity == sixthEntityKey.ToLowerInvariant())
            {
                responseJson = await GetSixthTableAsync(contactId, dataverseToken);
            }
            else if (entity == productAccessEntityKey.ToLowerInvariant())
            {
                responseJson = await GetProductAccessAsync(contactId, dataverseToken);
            }
            else if (entity == productSelectionEntityKey.ToLowerInvariant())
            {
                responseJson = await GetProductSelectionDataAsync(contactId, dataverseToken);
            }
            else
            {
                _logger.LogWarning("Unsupported entity requested. Entity: {Entity}, OID: {OID}, ContactId: {ContactId}", entity, oid, contactId);
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.BadRequest, $"Unsupported entity '{entity}'. Supported entities: projects, {secondaryEntityKey}, {thirdEntityKey}, {fourthEntityKey}, {fifthEntityKey}, {sixthEntityKey}, {productAccessEntityKey}, {productSelectionEntityKey}, {projectSpaceSubmitEntityKey}.");
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await response.WriteStringAsync(responseJson, Encoding.UTF8);
            return response;
        }
        catch (SecurityTokenException ex)
        {
            _logger.LogWarning(ex, "Token rejected.");
            return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Invalid token.");
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Configuration or Dataverse operation failed.");
            return await CreateJsonErrorResponseAsync(req, HttpStatusCode.InternalServerError, ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An error occurred while processing the request.");
            return await CreateJsonErrorResponseAsync(req, HttpStatusCode.InternalServerError, "An unexpected error occurred while processing the request.");
        }
    }

    private async Task<ClaimsPrincipal?> ValidateTokenAsync(string token)
    {
        try
        {
            var externalIssuer = GetRequiredEnvironmentVariable("External_Issuer");
            var externalClientId = GetRequiredEnvironmentVariable("External_ClientId");
            var externalPolicy = Environment.GetEnvironmentVariable("External_Policy");
            var metadataUrl = GetRequiredEnvironmentVariable("External_MetadataUrl");

            EnsureOpenIdConfigurationManager(metadataUrl);

            var config = await _oidcConfigurationManager!.GetConfigurationAsync(default);

            var validationParameters = new TokenValidationParameters
            {
                ValidIssuer = externalIssuer,
                ValidAudience = externalClientId,
                IssuerSigningKeys = config.SigningKeys,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidateIssuer = true,
                ValidateAudience = true,
                ClockSkew = TimeSpan.FromMinutes(5)
            };

            var handler = new JwtSecurityTokenHandler();
            var principal = handler.ValidateToken(token, validationParameters, out _);

            var policyClaim = principal.Claims.FirstOrDefault(c => c.Type == "tfp")?.Value
                ?? principal.Claims.FirstOrDefault(c => c.Type == "acr")?.Value;

            if (!string.IsNullOrWhiteSpace(externalPolicy) &&
                !string.Equals(policyClaim, externalPolicy, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Token policy validation failed. Expected: {ExpectedPolicy}, Actual: {ActualPolicy}", externalPolicy, policyClaim);
                throw new SecurityTokenValidationException("Token policy is invalid.");
            }
            else if (string.IsNullOrWhiteSpace(externalPolicy))
            {
                _logger.LogInformation("External_Policy not configured. Skipping tfp/acr policy claim validation.");
            }

            var oid = GetFirstClaimValue(
                principal,
                "oid",
                "http://schemas.microsoft.com/identity/claims/objectidentifier",
                "sub",
                ClaimTypes.NameIdentifier,
                "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier");
            _logger.LogInformation("Token validated successfully. OID: {OID}", oid);
            return principal;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Token validation failed.");
            return null;
        }
    }

    private async Task<string?> AcquireDataverseTokenAsync()
    {
        try
        {
            var internalClientId = GetRequiredEnvironmentVariable("Internal_ClientId");
            var internalClientSecret = GetRequiredEnvironmentVariable("Internal_ClientSecret");
            var internalTenantId = GetRequiredEnvironmentVariable("Internal_TenantId");
            var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');

            var app = ConfidentialClientApplicationBuilder.Create(internalClientId)
                .WithClientSecret(internalClientSecret)
                .WithAuthority(new Uri($"https://login.microsoftonline.com/{internalTenantId}"))
                .Build();

            var scopes = new[] { $"{dataverseUrl}/.default" };
            var authResult = await app.AcquireTokenForClient(scopes).ExecuteAsync();

            _logger.LogInformation("Dataverse token acquired successfully.");
            return authResult.AccessToken;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to acquire Dataverse token.");
            return null;
        }
    }

    private async Task<string?> GetContactAsync(string oid, string? email, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var contactsTable = GetEnvironmentVariableOrDefault("Dataverse_ContactsTable", "contacts");
        var contactIdField = GetEnvironmentVariableOrDefault("Dataverse_ContactIdField", "contactid");
        var b2cObjectIdField = GetEnvironmentVariableOrDefault("Dataverse_ContactB2cObjectIdField", "prithu_b2cobjectid");
        var emailField = GetEnvironmentVariableOrDefault("Dataverse_ContactEmailField", "emailaddress1");
        var escapedOid = EscapeODataString(oid);

        var byOidUrl = $"{dataverseUrl}/api/data/v9.2/{contactsTable}?$filter={b2cObjectIdField} eq '{escapedOid}'&$select={contactIdField}";
        var byOidResponseBody = await SendDataverseGetAsync(byOidUrl, dataverseToken);
        var contactId = ExtractFirstId(byOidResponseBody, contactIdField);

        if (!string.IsNullOrEmpty(contactId))
        {
            _logger.LogInformation("Contact found by OID. OID: {OID}, ContactId: {ContactId}", oid, contactId);
            return contactId;
        }

        if (string.IsNullOrWhiteSpace(email))
        {
            _logger.LogWarning("Contact not found by OID and email fallback is unavailable. OID: {OID}", oid);
            return null;
        }

        var escapedEmail = EscapeODataString(email);

        var byEmailUrl = $"{dataverseUrl}/api/data/v9.2/{contactsTable}?$filter={emailField} eq '{escapedEmail}'&$select={contactIdField}";
        var byEmailResponseBody = await SendDataverseGetAsync(byEmailUrl, dataverseToken);
        contactId = ExtractFirstId(byEmailResponseBody, contactIdField);

        if (string.IsNullOrEmpty(contactId))
        {
            return null;
        }

        var patchUrl = $"{dataverseUrl}/api/data/v9.2/{contactsTable}({contactId})";
        var patchData = new Dictionary<string, string>
        {
            [b2cObjectIdField] = oid
        };
        using var patchRequest = new HttpRequestMessage(new HttpMethod("PATCH"), patchUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(patchData), Encoding.UTF8, "application/json")
        };
        patchRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        patchRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        patchRequest.Headers.Add("OData-Version", "4.0");
        patchRequest.Headers.Add("OData-MaxVersion", "4.0");

        using var patchResponse = await _httpClient.SendAsync(patchRequest);
        if (!patchResponse.IsSuccessStatusCode)
        {
            var patchError = await patchResponse.Content.ReadAsStringAsync();
            _logger.LogError("Failed to patch contact with OID. OID: {OID}, ContactId: {ContactId}, Status: {StatusCode}, Error: {Error}", oid, contactId, (int)patchResponse.StatusCode, patchError);
            throw new InvalidOperationException("Failed to update contact with B2C object id.");
        }

        _logger.LogInformation("Contact found by email and updated with OID. OID: {OID}, ContactId: {ContactId}", oid, contactId);
        return contactId;
    }

    private async Task<string> GetProjectsAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var projectsTable = GetEnvironmentVariableOrDefault("Dataverse_ProjectsTable", "projects");
        var projectContactLookupField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsCustomerLookupField", "_customerid_value");
        var projectsSelectFields = Environment.GetEnvironmentVariable("Dataverse_ProjectsSelectFields")?.Trim();
        var escapedContactId = EscapeODataString(contactId);
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{projectsTable}?$filter={projectContactLookupField} eq '{escapedContactId}'{BuildSelectClause(projectsSelectFields)}";

        using var request = new HttpRequestMessage(HttpMethod.Get, queryUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("Prefer", "odata.include-annotations=\"OData.Community.Display.V1.FormattedValue\"");
        request.Headers.Add("OData-Version", "4.0");
        request.Headers.Add("OData-MaxVersion", "4.0");

        using var response = await _httpClient.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to retrieve projects. Table: {ProjectsTable}, LookupField: {LookupField}, ContactId: {ContactId}, Status: {StatusCode}, Error: {Error}", projectsTable, projectContactLookupField, contactId, (int)response.StatusCode, content);
            throw new InvalidOperationException("Failed to retrieve projects from Dataverse.");
        }

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var projectArray) || projectArray.ValueKind != JsonValueKind.Array)
        {
            _logger.LogWarning("Projects payload missing 'value' array. Table: {ProjectsTable}, ContactId: {ContactId}", projectsTable, contactId);
            return "[]";
        }

        var projectCount = projectArray.GetArrayLength();
        _logger.LogInformation("Retrieved {ProjectCount} projects. Table: {ProjectsTable}, LookupField: {LookupField}, ContactId: {ContactId}", projectCount, projectsTable, projectContactLookupField, contactId);
        return projectArray.GetRawText();
    }

    private async Task<string> GetSecondaryEntityAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var secondaryTable = GetRequiredEnvironmentVariable("Dataverse_SecondaryTable");
        var secondaryMode = GetEnvironmentVariableOrDefault("Dataverse_SecondaryMode", "CustomerLookup");
        var secondarySelectFields = Environment.GetEnvironmentVariable("Dataverse_SecondarySelectFields")?.Trim();

        if (string.Equals(secondaryMode, "ProjectLookup", StringComparison.OrdinalIgnoreCase))
        {
            var projectIds = await GetProjectIdsForContactAsync(contactId, dataverseToken);
            if (projectIds.Count == 0)
            {
                _logger.LogInformation("No projects found for secondary project-based lookup. ContactId: {ContactId}", contactId);
                return "[]";
            }

            var secondaryProjectLookupField = GetRequiredEnvironmentVariable("Dataverse_SecondaryProjectLookupField");
            var projectFilter = string.Join(" or ", projectIds.Select(id => $"{secondaryProjectLookupField} eq '{EscapeODataString(id)}'"));
            var secondaryUrl = $"{dataverseUrl}/api/data/v9.2/{secondaryTable}?$filter={projectFilter}{BuildSelectClause(secondarySelectFields)}";
            var responseBody = await SendDataverseGetAsync(secondaryUrl, dataverseToken);

            using var jsonDoc = JsonDocument.Parse(responseBody);
            if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
            {
                return "[]";
            }

            _logger.LogInformation("Retrieved secondary records by project lookup. Table: {Table}, ContactId: {ContactId}, ProjectCount: {ProjectCount}, RecordCount: {RecordCount}", secondaryTable, contactId, projectIds.Count, values.GetArrayLength());
            return values.GetRawText();
        }

        var secondaryCustomerLookupField = GetRequiredEnvironmentVariable("Dataverse_SecondaryCustomerLookupField");
        var escapedContactId = EscapeODataString(contactId);
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{secondaryTable}?$filter={secondaryCustomerLookupField} eq '{escapedContactId}'{BuildSelectClause(secondarySelectFields)}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var customerLookupDoc = JsonDocument.Parse(content);
        if (!customerLookupDoc.RootElement.TryGetProperty("value", out var customerLookupValues) || customerLookupValues.ValueKind != JsonValueKind.Array)
        {
            return "[]";
        }

        _logger.LogInformation("Retrieved secondary records by customer lookup. Table: {Table}, ContactId: {ContactId}, RecordCount: {RecordCount}", secondaryTable, contactId, customerLookupValues.GetArrayLength());
        return customerLookupValues.GetRawText();
    }

    private async Task<List<string>> GetProjectIdsForContactAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var projectsTable = GetEnvironmentVariableOrDefault("Dataverse_ProjectsTable", "projects");
        var projectContactLookupField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsCustomerLookupField", "_customerid_value");
        var projectIdField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsIdField", "sgr_projectid");
        var escapedContactId = EscapeODataString(contactId);
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{projectsTable}?$filter={projectContactLookupField} eq '{escapedContactId}'&$select={projectIdField}";

        var responseBody = await SendDataverseGetAsync(queryUrl, dataverseToken);
        using var jsonDoc = JsonDocument.Parse(responseBody);

        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }

        var ids = new List<string>();
        foreach (var item in values.EnumerateArray())
        {
            if (item.TryGetProperty(projectIdField, out var idProp))
            {
                var idValue = idProp.GetString();
                if (!string.IsNullOrWhiteSpace(idValue))
                {
                    ids.Add(idValue);
                }
            }
        }

        return ids;
    }

    private async Task<string> GetThirdTableAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var thirdTable = GetRequiredEnvironmentVariable("Dataverse_3rdTable");
        var thirdProjectLookupField = GetRequiredEnvironmentVariable("Dataverse_3rdProjectLookupField");
        var thirdSelectFields = Environment.GetEnvironmentVariable("Dataverse_3rdSelectFields")?.Trim();

        var projectIds = await GetProjectIdsForContactAsync(contactId, dataverseToken);
        if (projectIds.Count == 0)
        {
            _logger.LogInformation("No projects found for 3rd table lookup. ContactId: {ContactId}", contactId);
            return "[]";
        }

        var projectFilter = string.Join(" or ", projectIds.Select(id => $"{thirdProjectLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{thirdTable}?$filter={projectFilter}{BuildSelectClause(thirdSelectFields)}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return "[]";
        }

        _logger.LogInformation("Retrieved 3rd table records. Table: {Table}, ContactId: {ContactId}, ProjectCount: {ProjectCount}, RecordCount: {RecordCount}", thirdTable, contactId, projectIds.Count, values.GetArrayLength());
        return values.GetRawText();
    }

    private async Task<string> GetFourthTableAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var fourthTable = GetRequiredEnvironmentVariable("Dataverse_4thTable");
        var fourthThirdLookupField = GetRequiredEnvironmentVariable("Dataverse_4thThirdLookupField");
        var fourthSelectFields = Environment.GetEnvironmentVariable("Dataverse_4thSelectFields")?.Trim();

        var thirdIds = await GetThirdIdsForContactAsync(contactId, dataverseToken);
        if (thirdIds.Count == 0)
        {
            _logger.LogInformation("No 3rd table records found for 4th table lookup. ContactId: {ContactId}", contactId);
            return "[]";
        }

        var thirdFilter = string.Join(" or ", thirdIds.Select(id => $"{fourthThirdLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{fourthTable}?$filter={thirdFilter}{BuildSelectClause(fourthSelectFields)}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return "[]";
        }

        _logger.LogInformation("Retrieved 4th table records. Table: {Table}, ContactId: {ContactId}, ThirdRecordCount: {ThirdRecordCount}, RecordCount: {RecordCount}", fourthTable, contactId, thirdIds.Count, values.GetArrayLength());
        return values.GetRawText();
    }

    private static bool HasRequiredRole(ClaimsPrincipal principal, string requiredRole)
    {
        var required = requiredRole.Trim();
        if (string.IsNullOrEmpty(required))
        {
            return true;
        }

        // Entra roles may appear either as multiple "roles" claims or space/comma separated in one claim.
        var roleValues = principal.Claims
            .Where(c => string.Equals(c.Type, "roles", StringComparison.OrdinalIgnoreCase))
            .SelectMany(c => c.Value.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return roleValues.Contains(required);
    }

    private async Task<string> GetFifthTableAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var fifthTable = GetRequiredEnvironmentVariable("Dataverse_5thTable");
        var fifthLookupLevel = GetEnvironmentVariableOrDefault("Dataverse_5thLookupLevel", "Third");
        var fifthThirdLookupField = Environment.GetEnvironmentVariable("Dataverse_5thThirdLookupField");
        var fifthFourthLookupField = Environment.GetEnvironmentVariable("Dataverse_5thFourthLookupField");
        var fifthSelectFields = Environment.GetEnvironmentVariable("Dataverse_5thSelectFields")?.Trim();

        List<string> parentIds;
        string parentLookupField;
        string parentLevelLabel;

        if (string.Equals(fifthLookupLevel, "Fourth", StringComparison.OrdinalIgnoreCase))
        {
            parentIds = await GetFourthIdsForContactAsync(contactId, dataverseToken);
            parentLookupField = !string.IsNullOrWhiteSpace(fifthFourthLookupField)
                ? fifthFourthLookupField
                : GetRequiredEnvironmentVariable("Dataverse_5thFourthLookupField");
            parentLevelLabel = "4th";
        }
        else
        {
            parentIds = await GetThirdIdsForContactAsync(contactId, dataverseToken);
            parentLookupField = !string.IsNullOrWhiteSpace(fifthThirdLookupField)
                ? fifthThirdLookupField
                : GetEnvironmentVariableOrDefault("Dataverse_5thFourthLookupField", "_sgr_customeragreement_value");
            parentLevelLabel = "3rd";
        }

        if (parentIds.Count == 0)
        {
            _logger.LogInformation("No {ParentLevel} table records found for 5th table lookup. ContactId: {ContactId}", parentLevelLabel, contactId);
            return "[]";
        }

        var parentFilter = string.Join(" or ", parentIds.Select(id => $"{parentLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{fifthTable}?$filter={parentFilter}{BuildSelectClause(fifthSelectFields)}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return "[]";
        }

        _logger.LogInformation("Retrieved 5th table records. Table: {Table}, ContactId: {ContactId}, ParentLevel: {ParentLevel}, ParentRecordCount: {ParentRecordCount}, RecordCount: {RecordCount}", fifthTable, contactId, parentLevelLabel, parentIds.Count, values.GetArrayLength());
        return values.GetRawText();
    }

    private async Task<string> GetSixthTableAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var sixthTable = GetRequiredEnvironmentVariable("Dataverse_6thTable");
        var sixthProjectLookupField = GetRequiredEnvironmentVariable("Dataverse_6thProjectLookupField");
        var sixthSelectFields = Environment.GetEnvironmentVariable("Dataverse_6thSelectFields")?.Trim();
        var projectSpaceProductSetLookupField = GetEnvironmentVariableOrDefault("Dataverse_ProjectSpaceProductSetLookupField", "_sgr_productset_value");
        sixthSelectFields = EnsureSelectIncludesField(sixthSelectFields, projectSpaceProductSetLookupField);

        var projectIds = await GetProjectIdsForContactAsync(contactId, dataverseToken);
        if (projectIds.Count == 0)
        {
            _logger.LogInformation("No project records found for 6th table lookup. ContactId: {ContactId}", contactId);
            return "[]";
        }

        var projectFilter = string.Join(" or ", projectIds.Select(id => $"{sixthProjectLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{sixthTable}?$filter={projectFilter}{BuildSelectClause(sixthSelectFields)}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return "[]";
        }

        _logger.LogInformation("Retrieved 6th table records. Table: {Table}, ContactId: {ContactId}, ProjectCount: {ProjectCount}, RecordCount: {RecordCount}", sixthTable, contactId, projectIds.Count, values.GetArrayLength());
        return values.GetRawText();
    }

    private async Task<string> GetProductAccessAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var projectsTable = GetEnvironmentVariableOrDefault("Dataverse_ProjectsTable", "sgr_projects");
        var projectContactLookupField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsCustomerLookupField", "_sgr_customer_value");
        var projectAccessField = GetEnvironmentVariableOrDefault("Dataverse_ProductAccessField", "sgr_stage");
        var allowedValue = GetEnvironmentVariableOrDefault("Dataverse_ProductAccessAllowedValue", "1");
        var escapedContactId = EscapeODataString(contactId);
        var hasAccess = false;
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{projectsTable}?$filter={projectContactLookupField} eq '{escapedContactId}'&$select={projectAccessField}&$top=50";
        try
        {
            var content = await SendDataverseGetAsync(queryUrl, dataverseToken);
            using var jsonDoc = JsonDocument.Parse(content);
            if (jsonDoc.RootElement.TryGetProperty("value", out var values) && values.ValueKind == JsonValueKind.Array)
            {
                foreach (var record in values.EnumerateArray())
                {
                    if (record.TryGetProperty(projectAccessField, out var valueProp))
                    {
                        var raw = valueProp.ValueKind switch
                        {
                            JsonValueKind.Number => valueProp.GetRawText(),
                            JsonValueKind.String => valueProp.GetString() ?? string.Empty,
                            JsonValueKind.True => "true",
                            JsonValueKind.False => "false",
                            _ => string.Empty
                        };

                        if (string.Equals(raw, allowedValue, StringComparison.OrdinalIgnoreCase))
                        {
                            hasAccess = true;
                            break;
                        }
                    }
                }
            }
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Project-level access check failed. Returning no access. Field: {Field}, Table: {Table}", projectAccessField, projectsTable);
            hasAccess = false;
        }

        _logger.LogInformation("Resolved product access. ContactId: {ContactId}, Access: {HasAccess}", contactId, hasAccess);
        return JsonSerializer.Serialize(new { hasAccess });
    }

    private async Task<string> GetProductSelectionDataAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var productSetsTable = GetRequiredEnvironmentVariable("Dataverse_ProductSetsTable");
        var productSetsSelectFields = Environment.GetEnvironmentVariable("Dataverse_ProductSetsSelectFields")?.Trim();
        var productSetsIdField = GetEnvironmentVariableOrDefault("Dataverse_ProductSetsIdField", "sgr_productsetid");
        var productSetItemsTable = GetRequiredEnvironmentVariable("Dataverse_ProductSetItemsTable");
        var productSetItemsSetLookupField = GetRequiredEnvironmentVariable("Dataverse_ProductSetItemsProductSetLookupField");
        var productSetItemsMasterLookupField = GetRequiredEnvironmentVariable("Dataverse_ProductSetItemsProductMasterLookupField");
        var productSetItemsSelectFields = Environment.GetEnvironmentVariable("Dataverse_ProductSetItemsSelectFields")?.Trim();
        var productMastersTable = GetRequiredEnvironmentVariable("Dataverse_ProductMastersTable");
        var productMastersIdField = GetEnvironmentVariableOrDefault("Dataverse_ProductMastersIdField", "sgr_productmasterid");
        var productMastersSelectFields = Environment.GetEnvironmentVariable("Dataverse_ProductMastersSelectFields")?.Trim();
        var productSetsUrl = $"{dataverseUrl}/api/data/v9.2/{productSetsTable}?{BuildSelectQueryWithoutFilter(productSetsSelectFields)}";
        var productSetsRaw = await GetValueArrayRawAsync(productSetsUrl, dataverseToken, "product sets");
        var productSetIds = ExtractIdValuesFromRawArray(productSetsRaw, productSetsIdField);

        if (productSetIds.Count == 0)
        {
            _logger.LogInformation("No product sets found. ContactId: {ContactId}", contactId);
            return "{\"productSets\":[],\"productSetItems\":[],\"productMasters\":[]}";
        }

        var productSetItemsFilter = string.Join(" or ", productSetIds.Select(id => $"{productSetItemsSetLookupField} eq '{EscapeODataString(id)}'"));
        var productSetItemsUrl = $"{dataverseUrl}/api/data/v9.2/{productSetItemsTable}?$filter={productSetItemsFilter}{BuildSelectClause(productSetItemsSelectFields)}";
        var productSetItemsRaw = await GetValueArrayRawAsync(productSetItemsUrl, dataverseToken, "product set items");
        var productMasterIds = ExtractIdValuesFromRawArray(productSetItemsRaw, productSetItemsMasterLookupField);

        if (productMasterIds.Count == 0)
        {
            _logger.LogInformation("No product masters linked to product set items. ContactId: {ContactId}, ProductSetCount: {ProductSetCount}", contactId, productSetIds.Count);
            return $"{{\"productSets\":{productSetsRaw},\"productSetItems\":{productSetItemsRaw},\"productMasters\":[]}}";
        }

        var mastersFilter = string.Join(" or ", productMasterIds.Select(id => $"{productMastersIdField} eq '{EscapeODataString(id)}'"));
        var productMastersUrl = $"{dataverseUrl}/api/data/v9.2/{productMastersTable}?$filter={mastersFilter}{BuildSelectClause(productMastersSelectFields)}";
        var productMastersRaw = await GetValueArrayRawAsync(productMastersUrl, dataverseToken, "product masters");

        _logger.LogInformation("Retrieved product selection payload. ContactId: {ContactId}, ProductSets: {ProductSetCount}, ProductSetItems: {ProductSetItemsCount}, ProductMasters: {ProductMastersCount}", contactId, productSetIds.Count, CountElementsInRawArray(productSetItemsRaw), CountElementsInRawArray(productMastersRaw));
        return $"{{\"productSets\":{productSetsRaw},\"productSetItems\":{productSetItemsRaw},\"productMasters\":{productMastersRaw}}}";
    }

    private async Task<string> UpdateProjectSpaceSelectionAsync(Microsoft.Azure.Functions.Worker.Http.HttpRequestData req, string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var projectSpacesTable = GetEnvironmentVariableOrDefault("Dataverse_6thTable", "sgr_projectspaces");
        var projectSpaceIdField = GetEnvironmentVariableOrDefault("Dataverse_ProjectSpaceIdField", "sgr_projectspaceid");
        var projectSpaceProjectLookupField = GetEnvironmentVariableOrDefault("Dataverse_6thProjectLookupField", "_sgr_project_value");
        var customerSelectionField = GetEnvironmentVariableOrDefault("Dataverse_ProjectSpaceCustomerSelectionField", "sgr_customerselection");
        var productSetLookupBindField = GetEnvironmentVariableOrDefault("Dataverse_ProjectSpaceProductSetLookupBindField", "sgr_productset@odata.bind");
        var productSetTable = GetEnvironmentVariableOrDefault("Dataverse_ProductSetsTable", "sgr_productsets");
        var projectsTable = GetEnvironmentVariableOrDefault("Dataverse_ProjectsTable", "sgr_projects");
        var projectsIdField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsIdField", "sgr_projectid");
        var projectContactLookupField = GetEnvironmentVariableOrDefault("Dataverse_ProjectsCustomerLookupField", "_sgr_customer_value");

        using var reader = new StreamReader(req.Body);
        var requestBody = await reader.ReadToEndAsync();
        using var bodyDoc = JsonDocument.Parse(requestBody);
        var root = bodyDoc.RootElement;

        var projectSpaceId = root.TryGetProperty("projectSpaceId", out var psIdProp) ? psIdProp.GetString() : null;
        if (string.IsNullOrWhiteSpace(projectSpaceId))
        {
            throw new InvalidOperationException("projectSpaceId is required.");
        }

        int? customerSelection = null;
        if (root.TryGetProperty("customerSelection", out var customerSelectionProp))
        {
            if (customerSelectionProp.ValueKind == JsonValueKind.Number && customerSelectionProp.TryGetInt32(out var numberValue))
            {
                customerSelection = numberValue;
            }
            else if (customerSelectionProp.ValueKind == JsonValueKind.String && int.TryParse(customerSelectionProp.GetString(), out var parsedValue))
            {
                customerSelection = parsedValue;
            }
        }

        if (!customerSelection.HasValue)
        {
            throw new InvalidOperationException("customerSelection is required.");
        }

        var productSetId = root.TryGetProperty("productSetId", out var productSetProp) ? productSetProp.GetString() : null;
        if (customerSelection.Value != 2)
        {
            productSetId = null;
        }

        // Validate that the project space belongs to one of the contact's projects.
        var ownershipCheckUrl = $"{dataverseUrl}/api/data/v9.2/{projectSpacesTable}?$filter={projectSpaceIdField} eq '{EscapeODataString(projectSpaceId)}'&$select={projectSpaceProjectLookupField}";
        var ownershipBody = await SendDataverseGetAsync(ownershipCheckUrl, dataverseToken);
        using var ownershipDoc = JsonDocument.Parse(ownershipBody);
        if (!ownershipDoc.RootElement.TryGetProperty("value", out var spaces) || spaces.ValueKind != JsonValueKind.Array || spaces.GetArrayLength() == 0)
        {
            throw new InvalidOperationException("Project space not found.");
        }

        var linkedProjectId = spaces[0].TryGetProperty(projectSpaceProjectLookupField, out var projectProp) ? projectProp.GetString() : null;
        if (string.IsNullOrWhiteSpace(linkedProjectId))
        {
            throw new InvalidOperationException("Project space is not linked to a project.");
        }

        var ownerProjectCheckUrl = $"{dataverseUrl}/api/data/v9.2/{projectsTable}?$filter={projectsIdField} eq '{EscapeODataString(linkedProjectId)}' and {projectContactLookupField} eq '{EscapeODataString(contactId)}'&$select={projectsIdField}";
        var ownerProjectBody = await SendDataverseGetAsync(ownerProjectCheckUrl, dataverseToken);
        using var ownerDoc = JsonDocument.Parse(ownerProjectBody);
        if (!ownerDoc.RootElement.TryGetProperty("value", out var ownerProjects) || ownerProjects.ValueKind != JsonValueKind.Array || ownerProjects.GetArrayLength() == 0)
        {
            throw new InvalidOperationException("You are not authorized to update this project space.");
        }

        var patchPayload = new Dictionary<string, object?>
        {
            [customerSelectionField] = customerSelection.Value,
            [productSetLookupBindField] = productSetId is null ? null : $"/{productSetTable}({productSetId})"
        };

        var patchUrl = $"{dataverseUrl}/api/data/v9.2/{projectSpacesTable}({projectSpaceId})";
        using var patchRequest = new HttpRequestMessage(new HttpMethod("PATCH"), patchUrl)
        {
            Content = new StringContent(JsonSerializer.Serialize(patchPayload), Encoding.UTF8, "application/json")
        };
        patchRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        patchRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        patchRequest.Headers.Add("OData-Version", "4.0");
        patchRequest.Headers.Add("OData-MaxVersion", "4.0");

        using var patchResponse = await _httpClient.SendAsync(patchRequest);
        if (!patchResponse.IsSuccessStatusCode)
        {
            var errorBody = await patchResponse.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"Failed to update project space selection. Status={(int)patchResponse.StatusCode}. Error={errorBody}");
        }

        _logger.LogInformation("Project space selection updated. ContactId: {ContactId}, ProjectSpaceId: {ProjectSpaceId}, CustomerSelection: {CustomerSelection}, ProductSetId: {ProductSetId}", contactId, projectSpaceId, customerSelection.Value, productSetId);
        return JsonSerializer.Serialize(new { success = true });
    }

    private async Task<List<string>> GetThirdIdsForContactAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var thirdTable = Environment.GetEnvironmentVariable("Dataverse_3rdTable");
        if (string.IsNullOrWhiteSpace(thirdTable))
        {
            thirdTable = GetRequiredEnvironmentVariable("Dataverse_SecondaryTable");
        }

        var thirdProjectLookupField = Environment.GetEnvironmentVariable("Dataverse_3rdProjectLookupField");
        if (string.IsNullOrWhiteSpace(thirdProjectLookupField))
        {
            thirdProjectLookupField = GetRequiredEnvironmentVariable("Dataverse_SecondaryProjectLookupField");
        }

        var thirdIdField = Environment.GetEnvironmentVariable("Dataverse_3rdIdField");
        if (string.IsNullOrWhiteSpace(thirdIdField))
        {
            thirdIdField = GetEnvironmentVariableOrDefault("Dataverse_SecondaryIdField", "sgr_customeragreementid");
        }

        var projectIds = await GetProjectIdsForContactAsync(contactId, dataverseToken);
        if (projectIds.Count == 0)
        {
            return new List<string>();
        }

        var projectFilter = string.Join(" or ", projectIds.Select(id => $"{thirdProjectLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{thirdTable}?$filter={projectFilter}&$select={thirdIdField}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }

        var ids = new List<string>();
        foreach (var item in values.EnumerateArray())
        {
            if (item.TryGetProperty(thirdIdField, out var idProp))
            {
                var idValue = idProp.GetString();
                if (!string.IsNullOrWhiteSpace(idValue))
                {
                    ids.Add(idValue);
                }
            }
        }

        return ids;
    }

    private async Task<List<string>> GetFourthIdsForContactAsync(string contactId, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var fourthTable = GetRequiredEnvironmentVariable("Dataverse_4thTable");
        var fourthThirdLookupField = GetRequiredEnvironmentVariable("Dataverse_4thThirdLookupField");
        var fourthIdField = GetEnvironmentVariableOrDefault("Dataverse_4thIdField", "sgr_paymentmilestoneid");

        var thirdIds = await GetThirdIdsForContactAsync(contactId, dataverseToken);
        if (thirdIds.Count == 0)
        {
            return new List<string>();
        }

        var thirdFilter = string.Join(" or ", thirdIds.Select(id => $"{fourthThirdLookupField} eq '{EscapeODataString(id)}'"));
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/{fourthTable}?$filter={thirdFilter}&$select={fourthIdField}";
        var content = await SendDataverseGetAsync(queryUrl, dataverseToken);

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }

        var ids = new List<string>();
        foreach (var item in values.EnumerateArray())
        {
            if (item.TryGetProperty(fourthIdField, out var idProp))
            {
                var idValue = idProp.GetString();
                if (!string.IsNullOrWhiteSpace(idValue))
                {
                    ids.Add(idValue);
                }
            }
        }

        return ids;
    }

    private static void EnsureOpenIdConfigurationManager(string metadataUrl)
    {
        if (_oidcConfigurationManager != null && string.Equals(_oidcMetadataUrl, metadataUrl, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        lock (_oidcConfigLock)
        {
            if (_oidcConfigurationManager != null && string.Equals(_oidcMetadataUrl, metadataUrl, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            _oidcConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
                metadataUrl,
                new OpenIdConnectConfigurationRetriever());
            _oidcMetadataUrl = metadataUrl;
        }
    }

    private static string GetRequiredEnvironmentVariable(string key)
    {
        var value = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"Required environment variable '{key}' is not configured.");
        }

        return value;
    }

    private static string EscapeODataString(string value)
    {
        return value.Replace("'", "''", StringComparison.Ordinal);
    }

    private static string BuildSelectClause(string? selectFields)
    {
        return string.IsNullOrWhiteSpace(selectFields) ? string.Empty : $"&$select={selectFields}";
    }

    private static string EnsureSelectIncludesField(string? selectFields, string requiredField)
    {
        if (string.IsNullOrWhiteSpace(requiredField))
        {
            return selectFields ?? string.Empty;
        }

        if (string.IsNullOrWhiteSpace(selectFields))
        {
            return requiredField;
        }

        var fields = selectFields
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        if (fields.Any(f => string.Equals(f, requiredField, StringComparison.OrdinalIgnoreCase)))
        {
            return string.Join(",", fields);
        }

        fields.Add(requiredField);
        return string.Join(",", fields);
    }

    private static string BuildSelectQueryWithoutFilter(string? selectFields)
    {
        return string.IsNullOrWhiteSpace(selectFields) ? "$top=5000" : $"$select={selectFields}&$top=5000";
    }

    private static string? GetQueryParameter(Uri requestUri, string key)
    {
        var query = requestUri.Query;
        if (string.IsNullOrWhiteSpace(query))
        {
            return null;
        }

        var trimmed = query.TrimStart('?');
        var parts = trimmed.Split('&', StringSplitOptions.RemoveEmptyEntries);

        foreach (var part in parts)
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 0)
            {
                continue;
            }

            var name = Uri.UnescapeDataString(kv[0]);
            if (!string.Equals(name, key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (kv.Length == 1)
            {
                return string.Empty;
            }

            return Uri.UnescapeDataString(kv[1]);
        }

        return null;
    }

    private static string? GetFirstClaimValue(ClaimsPrincipal principal, params string[] claimTypes)
    {
        foreach (var claimType in claimTypes)
        {
            var value = principal.Claims.FirstOrDefault(c => c.Type == claimType)?.Value;
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }

    private static string? ExtractFirstId(string content, string idFieldName)
    {
        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() == 0)
        {
            return null;
        }

        return value[0].TryGetProperty(idFieldName, out var idProperty) ? idProperty.GetString() : null;
    }

    private async Task<string> SendDataverseGetAsync(string requestUrl, string dataverseToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("Prefer", "odata.include-annotations=\"OData.Community.Display.V1.FormattedValue\"");
        request.Headers.Add("OData-Version", "4.0");
        request.Headers.Add("OData-MaxVersion", "4.0");

        using var response = await _httpClient.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Dataverse GET failed. Url: {RequestUrl}, Status: {StatusCode}, Error: {Error}", requestUrl, (int)response.StatusCode, content);
            throw new InvalidOperationException($"Dataverse query failed. Status={(int)response.StatusCode}. Url={requestUrl}. Error={content}");
        }

        return content;
    }

    private async Task<string> GetValueArrayRawAsync(string requestUrl, string dataverseToken, string context)
    {
        var content = await SendDataverseGetAsync(requestUrl, dataverseToken);
        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var values) || values.ValueKind != JsonValueKind.Array)
        {
            _logger.LogWarning("Dataverse payload missing value array while fetching {Context}. Url: {Url}", context, requestUrl);
            return "[]";
        }

        return values.GetRawText();
    }

    private static List<string> ExtractIdValuesFromRawArray(string rawArray, string idField)
    {
        using var doc = JsonDocument.Parse(rawArray);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            if (!row.TryGetProperty(idField, out var idProp))
            {
                continue;
            }

            var id = idProp.GetString();
            if (!string.IsNullOrWhiteSpace(id))
            {
                ids.Add(id);
            }
        }

        return ids.ToList();
    }

    private static int CountElementsInRawArray(string rawArray)
    {
        using var doc = JsonDocument.Parse(rawArray);
        return doc.RootElement.ValueKind == JsonValueKind.Array ? doc.RootElement.GetArrayLength() : 0;
    }

    private static async Task<HttpResponseData> CreateJsonErrorResponseAsync(Microsoft.Azure.Functions.Worker.Http.HttpRequestData req, HttpStatusCode statusCode, string message)
    {
        var response = req.CreateResponse(statusCode);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");

        var payload = JsonSerializer.Serialize(new
        {
            error = new
            {
                code = (int)statusCode,
                message
            }
        });

        await response.WriteStringAsync(payload, Encoding.UTF8);
        return response;
    }

    private static string GetEnvironmentVariableOrDefault(string key, string defaultValue)
    {
        var value = Environment.GetEnvironmentVariable(key);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value.Trim();
    }
}

