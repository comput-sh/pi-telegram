using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using TelegramPi.BotProvisioner.Domain;
using TelegramPi.BotProvisioner.Services;

namespace TelegramPi.BotProvisioner.Functions;

public sealed class BotFunctions
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly BotProvisioningService _service;
    private readonly ILogger<BotFunctions> _logger;

    public BotFunctions(BotProvisioningService service, ILogger<BotFunctions> logger)
    {
        _service = service;
        _logger = logger;
    }

    [Function("getOrProvisionBot")]
    public async Task<IActionResult> GetOrProvisionBotAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "bots")] HttpRequest request)
    {
        GetOrProvisionRequest? body;
        try
        {
            body = await request.ReadFromJsonAsync<GetOrProvisionRequest>(JsonOptions, request.HttpContext.RequestAborted);
        }
        catch (JsonException)
        {
            return HttpResponses.Error(400, "Invalid request body.");
        }

        if (body?.ProjectName is null)
        {
            return HttpResponses.Error(400, "projectName must be a string.");
        }

        try
        {
            var result = await _service.GetOrProvisionAsync(
                body.ProjectName,
                body.BotUsername,
                request.HttpContext.RequestAborted);
            return HttpResponses.Json(result.Status == BotStatuses.Ready ? 200 : 202, result);
        }
        catch (ArgumentException error)
        {
            return HttpResponses.Error(400, error.Message);
        }
        catch (Exception error)
        {
            _logger.LogError(error, "getOrProvisionBot failed");
            return HttpResponses.Error(500, "Bot provisioning failed.");
        }
    }

    [Function("lookupBot")]
    public async Task<IActionResult> LookupBotAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "bots/lookup")] HttpRequest request)
    {
        GetOrProvisionRequest? body;
        try
        {
            body = await request.ReadFromJsonAsync<GetOrProvisionRequest>(JsonOptions, request.HttpContext.RequestAborted);
        }
        catch (JsonException)
        {
            return HttpResponses.Error(400, "Invalid request body.");
        }

        if (body?.ProjectName is null)
        {
            return HttpResponses.Error(400, "projectName must be a string.");
        }

        try
        {
            var result = await _service.LookupByProjectNameAsync(body.ProjectName, request.HttpContext.RequestAborted);
            return result is null
                ? HttpResponses.Error(404, "Bot record not found.")
                : HttpResponses.Json(200, result);
        }
        catch (ArgumentException error)
        {
            return HttpResponses.Error(400, error.Message);
        }
        catch (Exception error)
        {
            _logger.LogError(error, "lookupBot failed");
            return HttpResponses.Error(500, "Bot lookup failed.");
        }
    }

    [Function("getBot")]
    public async Task<IActionResult> GetBotAsync(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "bots/{projectKey}")] HttpRequest request,
        string projectKey)
    {
        if (string.IsNullOrWhiteSpace(projectKey))
        {
            return HttpResponses.Error(400, "projectKey is required.");
        }

        try
        {
            var result = await _service.GetAsync(projectKey.Trim(), request.HttpContext.RequestAborted);
            return result is null
                ? HttpResponses.Error(404, "Bot record not found.")
                : HttpResponses.Json(200, result);
        }
        catch (Exception error)
        {
            _logger.LogError(error, "getBot failed");
            return HttpResponses.Error(500, "Bot lookup failed.");
        }
    }

    private sealed record GetOrProvisionRequest(
        [property: System.Text.Json.Serialization.JsonPropertyName("projectName")] string? ProjectName,
        [property: System.Text.Json.Serialization.JsonPropertyName("botUsername")] string? BotUsername);
}
