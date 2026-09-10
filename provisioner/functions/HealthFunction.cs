using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace TelegramPi.BotProvisioner.Functions;

public sealed class HealthFunction
{
    [Function("health")]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest request) =>
        HttpResponses.Json(200, new
        {
            status = "ok",
            service = "TelegramPi Bot Provisioner",
            version = "0.1.0",
        });
}
