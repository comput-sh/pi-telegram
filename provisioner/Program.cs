using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using TelegramPi.BotProvisioner.Domain;
using TelegramPi.BotProvisioner.Infrastructure;
using TelegramPi.BotProvisioner.Services;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

var config = ProvisionerConfig.Load(builder.Configuration);
builder.Services.AddSingleton(config);
builder.Services.AddSingleton<IBotRepository, AzureTableBotRepository>();
builder.Services.AddSingleton<BotProvisioningService>();
builder.Services.AddHttpClient<ITelegramManagerClient, TelegramBotApiClient>(client =>
{
    client.BaseAddress = new Uri(config.TelegramApiBaseUrl);
    client.Timeout = TimeSpan.FromSeconds(20);
});
builder.Build().Run();
