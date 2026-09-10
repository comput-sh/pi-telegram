using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using TelegramPi.BotProvisioner.Domain;
using TelegramPi.BotProvisioner.Infrastructure;
using TelegramPi.BotProvisioner.Services;

namespace TelegramPi.BotProvisioner.Functions;

public sealed class TelegramFunctions
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly BotProvisioningService _service;
    private readonly ITelegramManagerClient _telegram;
    private readonly ProvisionerConfig _config;
    private readonly ILogger<TelegramFunctions> _logger;

    public TelegramFunctions(
        BotProvisioningService service,
        ITelegramManagerClient telegram,
        ProvisionerConfig config,
        ILogger<TelegramFunctions> logger)
    {
        _service = service;
        _telegram = telegram;
        _config = config;
        _logger = logger;
    }

    [Function("telegramWebhook")]
    public async Task<IActionResult> TelegramWebhookAsync(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "telegram/webhook")] HttpRequest request)
    {
        if (!SecretsEqual(request.Headers["X-Telegram-Bot-Api-Secret-Token"].FirstOrDefault(), _config.TelegramWebhookSecret))
        {
            return HttpResponses.Error(401, "Invalid Telegram webhook secret.");
        }

        TelegramUpdate? update;
        try
        {
            update = await request.ReadFromJsonAsync<TelegramUpdate>(JsonOptions, request.HttpContext.RequestAborted);
        }
        catch (JsonException)
        {
            return HttpResponses.Error(400, "Invalid Telegram update body.");
        }

        if (update?.UpdateId is null || update.ManagedBot?.User is null || update.ManagedBot.Bot is null)
        {
            return HttpResponses.Json(200, new { status = "ignored" });
        }

        try
        {
            var result = await _service.HandleManagedBotUpdateAsync(
                update.ManagedBot,
                update.UpdateId.Value,
                request.HttpContext.RequestAborted);
            if (result.Status == "ignored")
            {
                _logger.LogWarning("Ignored managed_bot update because no provisioning record matched.");
            }

            return HttpResponses.Json(200, result);
        }
        catch (Exception error)
        {
            _logger.LogError(error, "telegramWebhook failed");
            return HttpResponses.Error(500, "Managed bot update failed.");
        }
    }

    [Function("managerStatus")]
    public async Task<IActionResult> ManagerStatusAsync(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "telegram/manager")] HttpRequest request)
    {
        try
        {
            var identity = await _telegram.GetMeAsync(request.HttpContext.RequestAborted);
            return HttpResponses.Json(200, new
            {
                id = identity.Id,
                username = identity.Username,
                canManageBots = identity.CanManageBots is true,
            });
        }
        catch (Exception error)
        {
            _logger.LogError(error, "managerStatus failed");
            return HttpResponses.Error(502, "Telegram manager bot check failed.");
        }
    }

    [Function("registerTelegramWebhook")]
    public async Task<IActionResult> RegisterTelegramWebhookAsync(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "telegram/webhook/register")] HttpRequest request)
    {
        try
        {
            RegisterWebhookRequest? body = null;
            try
            {
                body = await request.ReadFromJsonAsync<RegisterWebhookRequest>(JsonOptions, request.HttpContext.RequestAborted);
            }
            catch (JsonException)
            {
                // An empty or malformed optional body means use the request origin.
            }

            var webhookUrl = string.IsNullOrWhiteSpace(body?.WebhookUrl)
                ? $"{request.Scheme}://{request.Host}/api/telegram/webhook"
                : body.WebhookUrl.Trim();
            if (!Uri.TryCreate(webhookUrl, UriKind.Absolute, out var parsed) ||
                (parsed.Scheme != Uri.UriSchemeHttps && parsed.Host is not "localhost" and not "127.0.0.1"))
            {
                return HttpResponses.Error(400, "webhookUrl must use HTTPS.");
            }

            await _telegram.SetWebhookAsync(webhookUrl, _config.TelegramWebhookSecret, request.HttpContext.RequestAborted);
            return HttpResponses.Json(200, new { status = "registered", webhookUrl });
        }
        catch (Exception error)
        {
            _logger.LogError(error, "registerTelegramWebhook failed");
            return HttpResponses.Error(502, "Telegram webhook registration failed.");
        }
    }

    private static bool SecretsEqual(string? actual, string expected)
    {
        if (actual is null)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(actual),
            Encoding.UTF8.GetBytes(expected));
    }

    private sealed record TelegramUpdate
    {
        [JsonPropertyName("update_id")]
        public long? UpdateId { get; init; }

        [JsonPropertyName("managed_bot")]
        public TelegramManagedBotUpdated? ManagedBot { get; init; }
    }

    private sealed record RegisterWebhookRequest(
        [property: JsonPropertyName("webhookUrl")] string? WebhookUrl);
}
