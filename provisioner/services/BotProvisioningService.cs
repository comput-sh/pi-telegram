using TelegramPi.BotProvisioner.Domain;
using TelegramPi.BotProvisioner.Infrastructure;

namespace TelegramPi.BotProvisioner.Services;

public sealed class BotProvisioningService
{
    private readonly IBotRepository _repository;
    private readonly ITelegramManagerClient _telegram;
    private readonly ProvisionerConfig _config;

    public BotProvisioningService(
        IBotRepository repository,
        ITelegramManagerClient telegram,
        ProvisionerConfig config)
    {
        _repository = repository;
        _telegram = telegram;
        _config = config;
    }

    public async Task<BotProvisioningResult> GetOrProvisionAsync(
        string projectName,
        string? botUsername = null,
        CancellationToken cancellationToken = default)
    {
        await _repository.InitializeAsync(cancellationToken);
        var naming = BotNaming.Create(
            projectName,
            _config.BotUsernamePrefix,
            _config.SetupBotUsername,
            botUsername);
        var existing = await _repository.GetByProjectKeyAsync(naming.ProjectKey, cancellationToken);
        if (existing is not null)
        {
            if (botUsername is null ||
                string.Equals(existing.BotUsername, naming.BotUsername, StringComparison.OrdinalIgnoreCase))
            {
                return BotProvisioningResult.From(existing);
            }

            if (existing.Status != BotStatuses.Pending)
            {
                throw new ArgumentException(
                    $"Project {existing.ProjectName} is already bound to ready bot @{existing.BotUsername}.");
            }

            var replacementOwner = await _repository.GetByBotUsernameAsync(naming.BotUsername, cancellationToken);
            if (replacementOwner is not null && replacementOwner.ProjectKey != existing.ProjectKey)
            {
                throw new ArgumentException(
                    $"Bot username @{naming.BotUsername} is already assigned to project {replacementOwner.ProjectName}.");
            }

            var updated = existing with
            {
                BotUsername = naming.BotUsername,
                BotUsernameLower = naming.BotUsername.ToLowerInvariant(),
                CreationUrl = naming.CreationUrl,
                UpdatedAt = DateTimeOffset.UtcNow.ToString("O"),
            };
            await _repository.SaveAsync(updated, cancellationToken);
            return BotProvisioningResult.From(updated);
        }

        var usernameOwner = await _repository.GetByBotUsernameAsync(naming.BotUsername, cancellationToken);
        if (usernameOwner is not null)
        {
            throw new ArgumentException(
                $"Bot username @{naming.BotUsername} is already assigned to project {usernameOwner.ProjectName}.");
        }

        var now = DateTimeOffset.UtcNow.ToString("O");
        var pending = new BotRecord
        {
            ProjectKey = naming.ProjectKey,
            ProjectName = naming.ProjectName,
            BotUsername = naming.BotUsername,
            BotUsernameLower = naming.BotUsername.ToLowerInvariant(),
            BotDisplayName = naming.BotDisplayName,
            CreationUrl = naming.CreationUrl,
            ProvisioningId = Guid.NewGuid().ToString("N"),
            Status = BotStatuses.Pending,
            CreatedAt = now,
            UpdatedAt = now,
        };

        if (await _repository.CreateAsync(pending, cancellationToken))
        {
            return BotProvisioningResult.From(pending);
        }

        var raced = await _repository.GetByProjectKeyAsync(naming.ProjectKey, cancellationToken);
        if (raced is null)
        {
            throw new InvalidOperationException("Bot provisioning record was created concurrently but could not be loaded.");
        }

        return BotProvisioningResult.From(raced);
    }

    public async Task<BotProvisioningResult?> LookupByProjectNameAsync(
        string projectName,
        CancellationToken cancellationToken = default)
    {
        await _repository.InitializeAsync(cancellationToken);
        var projectKey = BotNaming.CreateProjectKey(projectName);
        var record = await _repository.GetByProjectKeyAsync(projectKey, cancellationToken);
        return record is null ? null : BotProvisioningResult.From(record);
    }

    public async Task<BotProvisioningResult?> GetAsync(
        string projectKey,
        CancellationToken cancellationToken = default)
    {
        await _repository.InitializeAsync(cancellationToken);
        var record = await _repository.GetByProjectKeyAsync(projectKey, cancellationToken);
        return record is null ? null : BotProvisioningResult.From(record);
    }

    public async Task<ManagedBotUpdateResult> HandleManagedBotUpdateAsync(
        TelegramManagedBotUpdated update,
        long telegramUpdateId,
        CancellationToken cancellationToken = default)
    {
        if (update.User is null || update.Bot is null)
        {
            return new ManagedBotUpdateResult("ignored");
        }

        await _repository.InitializeAsync(cancellationToken);
        var botId = update.Bot.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var record = await _repository.FindByManagedBotAsync(botId, update.Bot.Username, cancellationToken);
        if (record is null)
        {
            return new ManagedBotUpdateResult("ignored");
        }

        var token = await _telegram.GetManagedBotTokenAsync(update.Bot.Id, cancellationToken);
        await _telegram.RestrictManagedBotToOwnerAsync(update.Bot.Id, cancellationToken);

        await _repository.SaveAsync(
            record with
            {
                Status = BotStatuses.Ready,
                BotId = botId,
                OwnerUserId = update.User.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Token = token,
                LastTelegramUpdateId = telegramUpdateId,
                UpdatedAt = DateTimeOffset.UtcNow.ToString("O"),
            },
            cancellationToken);

        return new ManagedBotUpdateResult("ready", record.ProjectKey);
    }
}
