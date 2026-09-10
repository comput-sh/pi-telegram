namespace TelegramPi.BotProvisioner.Domain;

public interface IBotRepository
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
    Task<BotRecord?> GetByProjectKeyAsync(string projectKey, CancellationToken cancellationToken = default);
    Task<BotRecord?> GetByBotUsernameAsync(string botUsername, CancellationToken cancellationToken = default);
    Task<BotRecord?> FindByManagedBotAsync(string botId, string? botUsername, CancellationToken cancellationToken = default);
    Task<bool> CreateAsync(BotRecord record, CancellationToken cancellationToken = default);
    Task SaveAsync(BotRecord record, CancellationToken cancellationToken = default);
}
