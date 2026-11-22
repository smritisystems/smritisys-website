$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$adminId = 201
$adminEmail = "admin.phase10@example.com"
$tempSql = Join-Path $env:TEMP ("smritisys-local-admin-" + [guid]::NewGuid().ToString("N") + ".sql")
$tempNode = Join-Path $env:TEMP ("smritisys-local-admin-" + [guid]::NewGuid().ToString("N") + ".js")
$first = Read-Host "New local super-admin password (minimum 12 characters)" -AsSecureString
$confirm = Read-Host "Confirm new password" -AsSecureString
$firstPointer = [IntPtr]::Zero
$confirmPointer = [IntPtr]::Zero
$plainPassword = $null
$confirmPassword = $null
$passwordHash = $null

try {
    if ($first.Length -lt 12) {
        throw "Password must be at least 12 characters."
    }

    $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $confirmPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    $confirmPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPointer)
    if ($plainPassword -cne $confirmPassword) {
        throw "Passwords do not match."
    }

    npx wrangler d1 execute smritisys-db --local --file .\migrations\0012_rate_limits.sql
    if ($LASTEXITCODE -ne 0) {
        throw "Could not apply the local rate-limit migration."
    }

    $env:SMRITISYS_LOCAL_RESET_PASSWORD = $plainPassword
    $nodeSource = @'
const crypto = require("node:crypto");
const password = process.env.SMRITISYS_LOCAL_RESET_PASSWORD;
if (!password) process.exit(2);
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
process.stdout.write("pbkdf2-sha256$120000$" + salt.toString("hex") + "$" + hash.toString("hex"));
'@
    [IO.File]::WriteAllText($tempNode, $nodeSource, [Text.Encoding]::ASCII)
    $nodeOutput = & node $tempNode
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the password hash."
    }
    $passwordHash = ($nodeOutput -join "").Trim()
    if ($passwordHash -notmatch '^pbkdf2-sha256\$120000\$[0-9a-f]{32}\$[0-9a-f]{64}$') {
        throw "Could not create the password hash."
    }

    $sql = "UPDATE users SET password_hash = '$passwordHash' WHERE id = $adminId AND email = '$adminEmail' AND role = 'super_admin' RETURNING id;"
    [IO.File]::WriteAllText($tempSql, $sql, [Text.Encoding]::ASCII)
    $result = & npx wrangler d1 execute smritisys-db --local --file $tempSql 2>&1
    if ($LASTEXITCODE -ne 0) {
        $result | ForEach-Object { Write-Output $_ }
        throw "The local password reset failed."
    }
    if (($result -join "`n") -notmatch '"id"\s*:\s*201') {
        throw "The expected local super-admin account was not updated."
    }

    Write-Output "Local super-admin password reset successfully. No password was displayed."
}
finally {
    Remove-Item Env:\SMRITISYS_LOCAL_RESET_PASSWORD -ErrorAction SilentlyContinue
    if ($firstPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer)
    }
    if ($confirmPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPointer)
    }
    $plainPassword = $null
    $confirmPassword = $null
    $passwordHash = $null
    $first.Dispose()
    $confirm.Dispose()
    if (Test-Path -LiteralPath $tempSql) {
        Remove-Item -LiteralPath $tempSql -Force
    }
    if (Test-Path -LiteralPath $tempNode) {
        Remove-Item -LiteralPath $tempNode -Force
    }
}
