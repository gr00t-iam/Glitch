# Waits for the Glitch server to come up, then opens it in the default browser.
$url = 'http://127.0.0.1:5173'
for ($i = 0; $i -lt 40; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url | Out-Null
    Start-Process $url
    break
  } catch {
    Start-Sleep -Milliseconds 750
  }
}
