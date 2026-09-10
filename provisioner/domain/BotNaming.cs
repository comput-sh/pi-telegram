using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace TelegramPi.BotProvisioner.Domain;

public sealed record BotNamingResult(
    string ProjectKey,
    string ProjectName,
    string BotUsername,
    string BotDisplayName,
    string CreationUrl);

public static partial class BotNaming
{
    private const int TelegramUsernameMaxLength = 32;
    private const string TelegramUsernameSuffix = "Bot";

    public static BotNamingResult Create(
        string projectNameInput,
        string prefix,
        string setupBotUsernameInput,
        string? botUsernameInput = null)
    {
        var projectName = NormalizeProjectName(projectNameInput);
        var setupBotUsername = setupBotUsernameInput.Trim().TrimStart('@');
        if (!SetupBotUsernameRegex().IsMatch(setupBotUsername) || !setupBotUsername.EndsWith("bot", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("TELEGRAM_SETUP_BOT_USERNAME is not a valid Telegram bot username.");
        }

        var botUsername = botUsernameInput is null
            ? CreateBotUsername(projectName, prefix)
            : NormalizeBotUsername(botUsernameInput);
        return new BotNamingResult(
            CreateProjectKey(projectName),
            projectName,
            botUsername,
            projectName,
            $"https://t.me/newbot/{setupBotUsername}/{botUsername}?name={Uri.EscapeDataString(projectName)}");
    }

    public static string CreateProjectKey(string projectNameInput)
    {
        var projectName = NormalizeProjectName(projectNameInput);
        var slug = NonAlphaNumericRegex().Replace(RemoveDiacritics(projectName).ToLowerInvariant(), "-").Trim('-');
        if (slug.Length == 0)
        {
            slug = "project";
        }
        else if (slug.Length > 40)
        {
            slug = slug[..40];
        }
        return $"{slug}-{ShortHash(projectName.ToLowerInvariant(), 8)}";
    }

    public static string NormalizeBotUsername(string value)
    {
        var botUsername = (value ?? string.Empty).Trim().TrimStart('@');
        if (!SetupBotUsernameRegex().IsMatch(botUsername) || !botUsername.EndsWith("bot", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("botUsername must be 5 to 32 letters, digits, or underscores, start with a letter, and end with Bot.");
        }

        return botUsername;
    }

    public static string CreateBotUsername(string projectNameInput, string prefixInput)
    {
        var projectName = NormalizeProjectName(projectNameInput);
        var prefix = NormalizePrefix(prefixInput);
        var projectToken = ToProjectToken(projectName);
        var direct = $"{prefix}{projectToken}{TelegramUsernameSuffix}";
        if (direct.Length <= TelegramUsernameMaxLength)
        {
            return direct;
        }

        var hash = ShortHash(projectName.ToLowerInvariant(), 6);
        var availableProjectLength = TelegramUsernameMaxLength - prefix.Length - hash.Length - TelegramUsernameSuffix.Length;
        if (availableProjectLength < 1)
        {
            throw new ArgumentException("BOT_USERNAME_PREFIX is too long to generate a Telegram username.");
        }

        return $"{prefix}{projectToken[..availableProjectLength]}{hash}{TelegramUsernameSuffix}";
    }

    private static string NormalizeProjectName(string value)
    {
        var projectName = value?.Trim() ?? string.Empty;
        if (projectName.Length == 0)
        {
            throw new ArgumentException("projectName is required.");
        }

        if (projectName.Length > 128)
        {
            throw new ArgumentException("projectName must be 128 characters or fewer.");
        }

        return projectName;
    }

    private static string ToProjectToken(string projectName)
    {
        var parts = NonAlphaNumericRegex()
            .Split(RemoveDiacritics(projectName))
            .Where(part => part.Length > 0)
            .Select(part => char.ToUpperInvariant(part[0]) + part[1..]);
        var token = string.Concat(parts);
        if (token.Length == 0)
        {
            throw new ArgumentException("projectName must contain a letter or digit.");
        }

        return token;
    }

    private static string NormalizePrefix(string value)
    {
        var prefix = NonAlphaNumericRegex().Replace(RemoveDiacritics(value), string.Empty);
        if (!PrefixRegex().IsMatch(prefix))
        {
            throw new ArgumentException("BOT_USERNAME_PREFIX must start with a letter and contain at most 12 letters or digits.");
        }

        return prefix;
    }

    private static string RemoveDiacritics(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormKD);
        var builder = new StringBuilder(normalized.Length);
        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                builder.Append(character);
            }
        }

        return builder.ToString();
    }

    private static string ShortHash(string value, int length) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant()[..length];

    [GeneratedRegex("[^A-Za-z0-9]+")]
    private static partial Regex NonAlphaNumericRegex();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9]{0,11}$")]
    private static partial Regex PrefixRegex();

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_]{4,31}$")]
    private static partial Regex SetupBotUsernameRegex();
}
