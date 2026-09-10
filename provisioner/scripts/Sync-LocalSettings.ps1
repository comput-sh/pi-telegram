param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string] $FunctionApp
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'local.settings.json'

$cloudSettings = az functionapp config appsettings list `
    --resource-group $ResourceGroup `
    --name $FunctionApp `
    --output json | ConvertFrom-Json

$settingsByName = @{}
foreach ($setting in $cloudSettings) {
    $settingsByName[$setting.name] = $setting.value
}

$sharedKeys = @(
    'AzureWebJobsStorage',
    'BOT_TABLE_NAME',
    'BOT_USERNAME_PREFIX',
    'TELEGRAM_SETUP_BOT_USERNAME',
    'TELEGRAM_SETUP_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET'
)

$values = [ordered]@{ FUNCTIONS_WORKER_RUNTIME = 'dotnet-isolated' }
foreach ($key in $sharedKeys) {
    if ([string]::IsNullOrWhiteSpace($settingsByName[$key])) {
        throw "Function App setting '$key' is missing."
    }
    $values[$key] = $settingsByName[$key]
}

@{
    IsEncrypted = $false
    Values = $values
} | ConvertTo-Json -Depth 4 | Set-Content -Path $destination -Encoding utf8

Write-Host 'Synchronized local.settings.json without displaying secret values.'
