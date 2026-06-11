# Fix PDF URLs in Notion — strip ?usp=drivesdk from all imported archive records
# Patches only records that have a PDF URL containing "drivesdk"

$API = "https://sts-deploy.pages.dev/api/notion-pipeline"

# Fetch all orders from Notion
Write-Host "Fetching orders from Notion..." -ForegroundColor Cyan
$orders = Invoke-RestMethod -Uri $API -Method Get

$toFix = $orders | Where-Object { $_.pdfUrl -and $_.pdfUrl -like "*drivesdk*" }
Write-Host "Found $($toFix.Count) records with drivesdk URLs to fix." -ForegroundColor Yellow

$fixed = 0; $fail = 0
foreach ($o in $toFix) {
  $cleanUrl = $o.pdfUrl -replace '\?usp=drivesdk', ''
  $body = @{ notionId = $o.notionId; pdfUrl = $cleanUrl } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri $API -Method Post -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
    $fixed++
    Write-Host "  ✓ [$fixed/$($toFix.Count)] $($o.name)" -ForegroundColor Green
  } catch {
    $fail++
    Write-Host "  ✗ FAILED $($o.name): $_" -ForegroundColor Red
  }
  Start-Sleep -Milliseconds 350
}
Write-Host "`nDone. $fixed fixed, $fail failed." -ForegroundColor Cyan
