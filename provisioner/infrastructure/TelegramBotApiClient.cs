using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TelegramPi.BotProvisioner.Domain;

namespace TelegramPi.BotProvisioner.Infrastructure;

public sealed record TelegramManagerIdentity : TelegramUser
{
    [JsonPropertyName("can_manage_bots")]
    public bool? CanManageBots { get; init; }
}

public interface ITelegramManagerClient
{
    Task<TelegramManagerIdentity> GetMeAsync(CancellationToken cancellationToken = default);
    Task<string> GetManagedBotTokenAsync(long botId, CancellationToken cancellationToken = default);
    Task RestrictManagedBotToOwnerAsync(long botId, CancellationToken cancellationToken = default);
    Task SetWebhookAsync(string webhookUrl, string secretToken, CancellationToken cancellationToken = default);
}

public sealed class TelegramApiException : Exception
{
    public TelegramApiException(string method, string description, int? errorCode = null, Exception? innerException = null)
        : base($"Telegram API {method} failed: {description}", innerException)
    {
        ErrorCode = errorCode;
    }

    public int? ErrorCode { get; }
}

public sealed class TelegramBotApiClient : ITelegramManagerClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _httpClient;
    private readonly string _botToken;

    public TelegramBotApiClient(HttpClient httpClient, ProvisionerConfig config)
    {
        _httpClient = httpClient;
        _botToken = config.SetupBotToken;
    }

    public Task<TelegramManagerIdentity> GetMeAsync(CancellationToken cancellationToken = default) =>
        CallAsync<TelegramManagerIdentity>("getMe", new { }, cancellationToken);

    public Task<string> GetManagedBotTokenAsync(long botId, CancellationToken cancellationToken = default) =>
        CallAsync<string>("getManagedBotToken", new { user_id = botId }, cancellationToken);

    public async Task RestrictManagedBotToOwnerAsync(long botId, CancellationToken cancellationToken = default)
    {
        await CallAsync<bool>(
            "setManagedBotAccessSettings",
            new { user_id = botId, is_access_restricted = true, added_user_ids = Array.Empty<long>() },
            cancellationToken);
    }

    public async Task SetWebhookAsync(string webhookUrl, string secretToken, CancellationToken cancellationToken = default)
    {
        await CallAsync<bool>(
            "setWebhook",
            new
            {
                url = webhookUrl,
                secret_token = secretToken,
                allowed_updates = new[] { "managed_bot" },
                drop_pending_updates = false,
            },
            cancellationToken);
    }

    private async Task<T> CallAsync<T>(string method, object body, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            response = await _httpClient.PostAsJsonAsync($"/bot{_botToken}/{method}", body, JsonOptions, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TelegramApiException(method, "request timed out");
        }
        catch (HttpRequestException error)
        {
            throw new TelegramApiException(method, "request failed", innerException: error);
        }

        await using var content = await response.Content.ReadAsStreamAsync(cancellationToken);
        TelegramApiResponse? payload;
        try
        {
            payload = await JsonSerializer.DeserializeAsync<TelegramApiResponse>(content, JsonOptions, cancellationToken);
        }
        catch (JsonException error)
        {
            throw new TelegramApiException(method, $"invalid HTTP {(int)response.StatusCode} response", innerException: error);
        }

        if (!response.IsSuccessStatusCode || payload is null || !payload.Ok || payload.Result.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            throw new TelegramApiException(
                method,
                payload?.Description ?? $"HTTP {(int)response.StatusCode}",
                payload?.ErrorCode);
        }

        try
        {
            return payload.Result.Deserialize<T>(JsonOptions)
                ?? throw new TelegramApiException(method, "response result was null");
        }
        catch (JsonException error)
        {
            throw new TelegramApiException(method, "response result had an unexpected shape", innerException: error);
        }
    }

    private sealed record TelegramApiResponse
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; init; }

        [JsonPropertyName("result")]
        public JsonElement Result { get; init; }

        [JsonPropertyName("description")]
        public string? Description { get; init; }

        [JsonPropertyName("error_code")]
        public int? ErrorCode { get; init; }
    }
}
