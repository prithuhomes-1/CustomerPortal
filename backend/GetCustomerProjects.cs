using System;
using System.IdentityModel.Tokens.Jwt;
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

            var oid = claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "oid")?.Value;
            var email = claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "email")?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
                ?? claimsPrincipal.Claims.FirstOrDefault(c => c.Type == "emails")?.Value;

            if (string.IsNullOrEmpty(oid) || string.IsNullOrEmpty(email))
            {
                _logger.LogWarning("Token missing required claims. OID present: {HasOid}, Email present: {HasEmail}", !string.IsNullOrEmpty(oid), !string.IsNullOrEmpty(email));
                return await CreateJsonErrorResponseAsync(req, HttpStatusCode.Unauthorized, "Required token claims are missing.");
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

            var projectsJson = await GetProjectsAsync(contactId, dataverseToken);

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await response.WriteStringAsync(projectsJson, Encoding.UTF8);
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
            var externalPolicy = GetRequiredEnvironmentVariable("External_Policy");
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

            if (!string.Equals(policyClaim, externalPolicy, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Token policy validation failed. Expected: {ExpectedPolicy}, Actual: {ActualPolicy}", externalPolicy, policyClaim);
                throw new SecurityTokenValidationException("Token policy is invalid.");
            }

            var oid = principal.Claims.FirstOrDefault(c => c.Type == "oid")?.Value;
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

    private async Task<string?> GetContactAsync(string oid, string email, string dataverseToken)
    {
        var dataverseUrl = GetRequiredEnvironmentVariable("Dataverse_Url").TrimEnd('/');
        var escapedOid = EscapeODataString(oid);
        var escapedEmail = EscapeODataString(email);

        var byOidUrl = $"{dataverseUrl}/api/data/v9.2/contacts?$filter=prithu_b2cobjectid eq '{escapedOid}'&$select=contactid";
        var byOidResponseBody = await SendDataverseGetAsync(byOidUrl, dataverseToken);
        var contactId = ExtractFirstContactId(byOidResponseBody);

        if (!string.IsNullOrEmpty(contactId))
        {
            _logger.LogInformation("Contact found by OID. OID: {OID}, ContactId: {ContactId}", oid, contactId);
            return contactId;
        }

        var byEmailUrl = $"{dataverseUrl}/api/data/v9.2/contacts?$filter=emailaddress1 eq '{escapedEmail}'&$select=contactid";
        var byEmailResponseBody = await SendDataverseGetAsync(byEmailUrl, dataverseToken);
        contactId = ExtractFirstContactId(byEmailResponseBody);

        if (string.IsNullOrEmpty(contactId))
        {
            return null;
        }

        var patchUrl = $"{dataverseUrl}/api/data/v9.2/contacts({contactId})";
        var patchData = new { prithu_b2cobjectid = oid };
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
        var escapedContactId = EscapeODataString(contactId);
        var queryUrl = $"{dataverseUrl}/api/data/v9.2/projects?$filter=_customerid_value eq '{escapedContactId}'";

        using var request = new HttpRequestMessage(HttpMethod.Get, queryUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("OData-Version", "4.0");
        request.Headers.Add("OData-MaxVersion", "4.0");

        using var response = await _httpClient.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Failed to retrieve projects. ContactId: {ContactId}, Status: {StatusCode}, Error: {Error}", contactId, (int)response.StatusCode, content);
            throw new InvalidOperationException("Failed to retrieve projects from Dataverse.");
        }

        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var projectArray) || projectArray.ValueKind != JsonValueKind.Array)
        {
            _logger.LogWarning("Projects payload missing 'value' array. ContactId: {ContactId}", contactId);
            return "[]";
        }

        var projectCount = projectArray.GetArrayLength();
        _logger.LogInformation("Retrieved {ProjectCount} projects. ContactId: {ContactId}", projectCount, contactId);
        return projectArray.GetRawText();
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

    private static string? ExtractFirstContactId(string content)
    {
        using var jsonDoc = JsonDocument.Parse(content);
        if (!jsonDoc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() == 0)
        {
            return null;
        }

        return value[0].TryGetProperty("contactid", out var contactIdProperty) ? contactIdProperty.GetString() : null;
    }

    private async Task<string> SendDataverseGetAsync(string requestUrl, string dataverseToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", dataverseToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("OData-Version", "4.0");
        request.Headers.Add("OData-MaxVersion", "4.0");

        using var response = await _httpClient.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Dataverse GET failed. Url: {RequestUrl}, Status: {StatusCode}, Error: {Error}", requestUrl, (int)response.StatusCode, content);
            throw new InvalidOperationException("Dataverse query failed.");
        }

        return content;
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
}

