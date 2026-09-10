using Azure;
using Azure.Data.Tables;
using TelegramPi.BotProvisioner.Domain;

namespace TelegramPi.BotProvisioner.Infrastructure;

public sealed class AzureTableBotRepository : IBotRepository
{
    private const string PartitionKey = "bots";
    private readonly TableClient _client;
    private readonly object _initializationLock = new();
    private Task? _initialization;

    public AzureTableBotRepository(ProvisionerConfig config)
    {
        _client = new TableClient(config.StorageConnectionString, config.TableName);
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        lock (_initializationLock)
        {
            return _initialization ??= _client.CreateIfNotExistsAsync(cancellationToken);
        }
    }

    public async Task<BotRecord?> GetByProjectKeyAsync(string projectKey, CancellationToken cancellationToken = default)
    {
        try
        {
            var response = await _client.GetEntityAsync<TableEntity>(PartitionKey, projectKey, cancellationToken: cancellationToken);
            return FromEntity(response.Value);
        }
        catch (RequestFailedException error) when (error.Status == 404)
        {
            return null;
        }
    }

    public async Task<BotRecord?> GetByBotUsernameAsync(
        string botUsername,
        CancellationToken cancellationToken = default)
    {
        var normalized = EscapeODataString(botUsername.ToLowerInvariant());
        var filter = $"PartitionKey eq '{PartitionKey}' and botUsernameLower eq '{normalized}'";
        await foreach (var entity in _client.QueryAsync<TableEntity>(filter, maxPerPage: 1, cancellationToken: cancellationToken))
        {
            return FromEntity(entity);
        }

        return null;
    }

    public async Task<BotRecord?> FindByManagedBotAsync(
        string botId,
        string? botUsername,
        CancellationToken cancellationToken = default)
    {
        var clauses = new List<string> { $"botId eq '{EscapeODataString(botId)}'" };
        if (!string.IsNullOrWhiteSpace(botUsername))
        {
            clauses.Add($"botUsernameLower eq '{EscapeODataString(botUsername.ToLowerInvariant())}'");
        }

        var filter = $"PartitionKey eq '{PartitionKey}' and ({string.Join(" or ", clauses)})";
        await foreach (var entity in _client.QueryAsync<TableEntity>(filter, maxPerPage: 1, cancellationToken: cancellationToken))
        {
            return FromEntity(entity);
        }

        return null;
    }

    public async Task<bool> CreateAsync(BotRecord record, CancellationToken cancellationToken = default)
    {
        try
        {
            await _client.AddEntityAsync(ToEntity(record), cancellationToken);
            return true;
        }
        catch (RequestFailedException error) when (error.Status == 409)
        {
            return false;
        }
    }

    public async Task SaveAsync(BotRecord record, CancellationToken cancellationToken = default)
    {
        await _client.UpdateEntityAsync(ToEntity(record), ETag.All, TableUpdateMode.Replace, cancellationToken);
    }

    private static TableEntity ToEntity(BotRecord record)
    {
        var entity = new TableEntity(PartitionKey, record.ProjectKey)
        {
            ["projectName"] = record.ProjectName,
            ["botUsername"] = record.BotUsername,
            ["botUsernameLower"] = record.BotUsernameLower,
            ["botDisplayName"] = record.BotDisplayName,
            ["creationUrl"] = record.CreationUrl,
            ["provisioningId"] = record.ProvisioningId,
            ["status"] = record.Status,
            ["createdAt"] = record.CreatedAt,
            ["updatedAt"] = record.UpdatedAt,
        };

        AddIfPresent(entity, "botId", record.BotId);
        AddIfPresent(entity, "ownerUserId", record.OwnerUserId);
        AddIfPresent(entity, "token", record.Token);
        if (record.LastTelegramUpdateId is not null)
        {
            entity["lastTelegramUpdateId"] = record.LastTelegramUpdateId.Value;
        }

        return entity;
    }

    private static BotRecord FromEntity(TableEntity entity)
    {
        var status = RequiredString(entity, "status");
        if (status is not BotStatuses.Pending and not BotStatuses.Ready)
        {
            throw new InvalidOperationException($"Bot record {entity.RowKey} has invalid status.");
        }

        return new BotRecord
        {
            ProjectKey = entity.RowKey,
            ProjectName = RequiredString(entity, "projectName"),
            BotUsername = RequiredString(entity, "botUsername"),
            BotUsernameLower = RequiredString(entity, "botUsernameLower"),
            BotDisplayName = RequiredString(entity, "botDisplayName"),
            CreationUrl = RequiredString(entity, "creationUrl"),
            ProvisioningId = RequiredString(entity, "provisioningId"),
            Status = status,
            BotId = OptionalString(entity, "botId"),
            OwnerUserId = OptionalString(entity, "ownerUserId"),
            Token = OptionalString(entity, "token"),
            LastTelegramUpdateId = OptionalInt64(entity, "lastTelegramUpdateId"),
            CreatedAt = RequiredString(entity, "createdAt"),
            UpdatedAt = RequiredString(entity, "updatedAt"),
        };
    }

    private static void AddIfPresent(TableEntity entity, string key, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            entity[key] = value;
        }
    }

    private static string RequiredString(TableEntity entity, string key) =>
        OptionalString(entity, key) ?? throw new InvalidOperationException($"Bot record {entity.RowKey} is missing {key}.");

    private static string? OptionalString(TableEntity entity, string key) =>
        entity.TryGetValue(key, out var value) ? Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) : null;

    private static long? OptionalInt64(TableEntity entity, string key) =>
        entity.TryGetValue(key, out var value) && value is not null
            ? Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture)
            : null;

    private static string EscapeODataString(string value) => value.Replace("'", "''", StringComparison.Ordinal);
}
