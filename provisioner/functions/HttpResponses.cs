using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace TelegramPi.BotProvisioner.Functions;

internal static class HttpResponses
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IActionResult Json(int statusCode, object body) =>
        new JsonResult(body, JsonOptions) { StatusCode = statusCode };

    public static IActionResult Error(int statusCode, string message) =>
        Json(statusCode, new { error = message });
}
