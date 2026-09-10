using Xunit;
using TelegramPi.BotProvisioner.Domain;
using TelegramPi.BotProvisioner.Infrastructure;
using TelegramPi.BotProvisioner.Services;

namespace TelegramPi.BotProvisioner.Tests;

public sealed class BotProvisioningTests
{
    [Fact]
    public void NamingUsesCpuPrefixAndProjectFolderName()
    {
        var naming = BotNaming.Create("TelegramPi", "cpu", "cpuTelegramSetupBot");

        Assert.Equal("cpuTelegramPiBot", naming.BotUsername);
        Assert.Equal("TelegramPi", naming.BotDisplayName);
        Assert.Equal(
            "https://t.me/newbot/cpuTelegramSetupBot/cpuTelegramPiBot?name=TelegramPi",
            naming.CreationUrl);
    }

    [Fact]
    public void ExplicitBotUsernameOverridesTheDerivedUsername()
    {
        var naming = BotNaming.Create(
            "TelegramPi",
            "cpu",
            "cpuTelegramSetupBot",
            "@cpuChosenBot");

        Assert.Equal("cpuChosenBot", naming.BotUsername);
        Assert.Contains("/cpuChosenBot?", naming.CreationUrl);
        Assert.Throws<ArgumentException>(() =>
            BotNaming.Create("TelegramPi", "cpu", "cpuTelegramSetupBot", "invalid-name"));
    }

    [Fact]
    public void LongProjectNamesProduceStableValidTelegramUsernames()
    {
        const string projectName = "A very long project folder name that exceeds Telegram limits";

        var first = BotNaming.CreateBotUsername(projectName, "cpu");
        var second = BotNaming.CreateBotUsername(projectName, "cpu");

        Assert.Equal(first, second);
        Assert.True(first.Length <= 32);
        Assert.Matches("^cpu[A-Za-z0-9]+Bot$", first);
    }

    [Fact]
    public async Task GetOrProvisionIsIdempotentForAProject()
    {
        var (_, _, service) = CreateService();

        var first = await service.GetOrProvisionAsync("TelegramPi");
        var second = await service.GetOrProvisionAsync("TelegramPi");

        Assert.Equal(BotStatuses.Pending, first.Status);
        Assert.Null(first.ConversationUrl);
        Assert.Equal(first.ProvisioningId, second.ProvisioningId);
        Assert.Equal("cpuTelegramPiBot", second.BotUsername);
    }

    [Fact]
    public async Task CustomUsernameIsIdempotentUniqueAndReplaceableWhilePending()
    {
        var (_, _, service) = CreateService();

        var first = await service.GetOrProvisionAsync("FirstProject", "cpuChosenBot");
        var repeated = await service.GetOrProvisionAsync("FirstProject", "cpuChosenBot");

        Assert.Equal("cpuChosenBot", first.BotUsername);
        Assert.Equal(first.ProvisioningId, repeated.ProvisioningId);
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.GetOrProvisionAsync("SecondProject", "cpuChosenBot"));

        var replaced = await service.GetOrProvisionAsync("FirstProject", "cpuDifferentBot");
        Assert.Equal("cpuDifferentBot", replaced.BotUsername);
        Assert.Equal(first.ProvisioningId, replaced.ProvisioningId);
        Assert.Contains("/cpuDifferentBot?", replaced.CreationUrl);
    }

    [Fact]
    public async Task LookupByProjectNameNeverCreatesARecord()
    {
        var (repository, _, service) = CreateService();

        var missing = await service.LookupByProjectNameAsync("TelegramPi");

        Assert.Null(missing);
        Assert.Equal(0, repository.Count);

        var provisioned = await service.GetOrProvisionAsync("TelegramPi");
        var found = await service.LookupByProjectNameAsync("TelegramPi");

        Assert.Equal(1, repository.Count);
        Assert.Equal(provisioned.ProvisioningId, found?.ProvisioningId);
    }

    [Fact]
    public async Task ManagedBotUpdateRetrievesTokenRestrictsAccessAndMarksBotReady()
    {
        var (_, telegram, service) = CreateService();
        var pending = await service.GetOrProvisionAsync("TelegramPi");

        var handled = await service.HandleManagedBotUpdateAsync(
            new TelegramManagedBotUpdated
            {
                User = new TelegramUser { Id = 42, Username = "comput" },
                Bot = new TelegramUser { Id = 99, Username = "cpuTelegramPiBot" },
            },
            123);
        var ready = await service.GetAsync(pending.ProjectKey);

        Assert.Equal("ready", handled.Status);
        Assert.Equal(pending.ProjectKey, handled.ProjectKey);
        Assert.Equal(new[] { "token:99", "restrict:99" }, telegram.Calls);
        Assert.Equal(BotStatuses.Ready, ready?.Status);
        Assert.Equal("42", ready?.OwnerUserId);
        Assert.Equal("child-token", ready?.Token);
        Assert.Equal(
            "https://t.me/cpuTelegramPiBot?start=telegrampi-04faf163",
            ready?.ConversationUrl);
        var error = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.GetOrProvisionAsync("TelegramPi", "cpuDifferentBot"));
        Assert.Contains("ready bot @cpuTelegramPiBot", error.Message);
    }

    [Fact]
    public async Task UnmatchedManagedBotsAreIgnoredWithoutRequestingTheirToken()
    {
        var (_, telegram, service) = CreateService();

        var result = await service.HandleManagedBotUpdateAsync(
            new TelegramManagedBotUpdated
            {
                User = new TelegramUser { Id = 42 },
                Bot = new TelegramUser { Id = 100, Username = "unrelatedBot" },
            },
            124);

        Assert.Equal("ignored", result.Status);
        Assert.Empty(telegram.Calls);
    }

    private static (MemoryBotRepository Repository, FakeTelegramManagerClient Telegram, BotProvisioningService Service) CreateService()
    {
        var repository = new MemoryBotRepository();
        var telegram = new FakeTelegramManagerClient();
        var config = new ProvisionerConfig(
            "UseDevelopmentStorage=true",
            "TelegramPiBots",
            "cpu",
            "cpuTelegramSetupBot",
            "manager-token",
            "webhook-secret",
            "https://api.telegram.org");
        return (repository, telegram, new BotProvisioningService(repository, telegram, config));
    }

    private sealed class MemoryBotRepository : IBotRepository
    {
        private readonly Dictionary<string, BotRecord> _records = new(StringComparer.Ordinal);

        public int Count => _records.Count;

        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<BotRecord?> GetByProjectKeyAsync(string projectKey, CancellationToken cancellationToken = default)
        {
            _records.TryGetValue(projectKey, out var record);
            return Task.FromResult(record);
        }

        public Task<BotRecord?> GetByBotUsernameAsync(
            string botUsername,
            CancellationToken cancellationToken = default)
        {
            var record = _records.Values.FirstOrDefault(candidate =>
                candidate.BotUsernameLower == botUsername.ToLowerInvariant());
            return Task.FromResult(record);
        }

        public Task<BotRecord?> FindByManagedBotAsync(
            string botId,
            string? botUsername,
            CancellationToken cancellationToken = default)
        {
            var record = _records.Values.FirstOrDefault(candidate =>
                candidate.BotId == botId ||
                (botUsername is not null && candidate.BotUsernameLower == botUsername.ToLowerInvariant()));
            return Task.FromResult(record);
        }

        public Task<bool> CreateAsync(BotRecord record, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_records.TryAdd(record.ProjectKey, record));
        }

        public Task SaveAsync(BotRecord record, CancellationToken cancellationToken = default)
        {
            _records[record.ProjectKey] = record;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeTelegramManagerClient : ITelegramManagerClient
    {
        public List<string> Calls { get; } = [];

        public Task<TelegramManagerIdentity> GetMeAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new TelegramManagerIdentity { Id = 1, Username = "cpuTelegramSetupBot", CanManageBots = true });

        public Task<string> GetManagedBotTokenAsync(long botId, CancellationToken cancellationToken = default)
        {
            Calls.Add($"token:{botId}");
            return Task.FromResult("child-token");
        }

        public Task RestrictManagedBotToOwnerAsync(long botId, CancellationToken cancellationToken = default)
        {
            Calls.Add($"restrict:{botId}");
            return Task.CompletedTask;
        }

        public Task SetWebhookAsync(string webhookUrl, string secretToken, CancellationToken cancellationToken = default)
        {
            Calls.Add($"webhook:{webhookUrl}");
            return Task.CompletedTask;
        }
    }
}
