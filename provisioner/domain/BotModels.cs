using System.Text.Json.Serialization;

namespace TelegramPi.BotProvisioner.Domain;

public static class BotStatuses
{
    public const string Pending = "pending";
    public const string Ready = "ready";
}

public sealed record BotRecord
{
    public required string ProjectKey { get; init; }
    public required string ProjectName { get; init; }
    public required string BotUsername { get; init; }
    public required string BotUsernameLower { get; init; }
    public required string BotDisplayName { get; init; }
    public required string CreationUrl { get; init; }
    public required string ProvisioningId { get; init; }
    public required string Status { get; init; }
    public string? BotId { get; init; }
    public string? OwnerUserId { get; init; }
    public string? Token { get; init; }
    public long? LastTelegramUpdateId { get; init; }
    public required string CreatedAt { get; init; }
    public required string UpdatedAt { get; init; }
}

public sealed record BotProvisioningResult(
    [property: JsonPropertyName("projectKey")] string ProjectKey,
    [property: JsonPropertyName("projectName")] string ProjectName,
    [property: JsonPropertyName("botUsername")] string BotUsername,
    [property: JsonPropertyName("botDisplayName")] string BotDisplayName,
    [property: JsonPropertyName("creationUrl")] string CreationUrl,
    [property: JsonPropertyName("provisioningId")] string ProvisioningId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("ownerUserId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? OwnerUserId,
    [property: JsonPropertyName("token"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Token,
    [property: JsonPropertyName("conversationUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ConversationUrl)
{
    public static BotProvisioningResult From(BotRecord record) => new(
        record.ProjectKey,
        record.ProjectName,
        record.BotUsername,
        record.BotDisplayName,
        record.CreationUrl,
        record.ProvisioningId,
        record.Status,
        record.OwnerUserId,
        record.Status == BotStatuses.Ready ? record.Token : null,
        record.Status == BotStatuses.Ready
            ? $"https://t.me/{record.BotUsername}?start={record.ProjectKey}"
            : null);
}

public record TelegramUser
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("username")]
    public string? Username { get; init; }

    [JsonPropertyName("first_name")]
    public string? FirstName { get; init; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; init; }
}

public sealed record TelegramManagedBotUpdated
{
    [JsonPropertyName("user")]
    public TelegramUser? User { get; init; }

    [JsonPropertyName("bot")]
    public TelegramUser? Bot { get; init; }
}

public sealed record ManagedBotUpdateResult(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("projectKey"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ProjectKey = null);
