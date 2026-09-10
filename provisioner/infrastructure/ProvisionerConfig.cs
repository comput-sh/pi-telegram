using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;

namespace TelegramPi.BotProvisioner.Infrastructure;

public sealed record ProvisionerConfig(
    string StorageConnectionString,
    string TableName,
    string BotUsernamePrefix,
    string SetupBotUsername,
    string SetupBotToken,
    string TelegramWebhookSecret,
    string TelegramApiBaseUrl)
{
    public static ProvisionerConfig Load(IConfiguration configuration)
    {
        var tableName = Optional(configuration, "BOT_TABLE_NAME") ?? "TelegramPiBots";
        if (!Regex.IsMatch(tableName, "^[A-Za-z][A-Za-z0-9]{2,62}$"))
        {
            throw new InvalidOperationException("BOT_TABLE_NAME must be a valid Azure Table name.");
        }

        return new ProvisionerConfig(
            Optional(configuration, "BOT_STORAGE_CONNECTION_STRING") ?? Required(configuration, "AzureWebJobsStorage"),
            tableName,
            Optional(configuration, "BOT_USERNAME_PREFIX") ?? "pi",
            Required(configuration, "TELEGRAM_SETUP_BOT_USERNAME"),
            Required(configuration, "TELEGRAM_SETUP_BOT_TOKEN"),
            Required(configuration, "TELEGRAM_WEBHOOK_SECRET"),
            Optional(configuration, "TELEGRAM_BOT_API_BASE_URL") ?? "https://api.telegram.org");
    }

    private static string Required(IConfiguration configuration, string name) =>
        Optional(configuration, name) ?? throw new InvalidOperationException($"Missing required application setting: {name}.");

    private static string? Optional(IConfiguration configuration, string name)
    {
        var value = configuration[name]?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }
}
