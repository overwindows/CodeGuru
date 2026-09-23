$ErrorActionPreference = 'Continue'
$ol = [activator]::CreateInstance([type]::GetTypeFromProgID('Outlook.Application'))
$ns = $ol.GetNamespace('MAPI')
$inbox = $ns.GetDefaultFolder(6)

$sb = New-Object System.Text.StringBuilder
try {
    $items = $inbox.Items
    $c = $items.Count
    for ($i=1; $i -le $c; $i++) {
        try {
            $it = $items.Item($i)
            [void]$sb.AppendLine("@@@@@@@@@@ ITEM $i @@@@@@@@@@")
            [void]$sb.AppendLine("SUBJECT: " + $it.Subject)
            [void]$sb.AppendLine("CLASS: " + $it.ItemClass)
            [void]$sb.AppendLine("FROM: " + $it.SenderName + " <" + $it.SenderEmailAddress + ">")
            [void]$sb.AppendLine("TO: " + $it.To)
            [void]$sb.AppendLine("RECV: " + $it.ReceivedTime)
            [void]$sb.AppendLine("----- BODY -----")
            [void]$sb.AppendLine($it.Body)
            [void]$sb.AppendLine("")
        } catch {
            [void]$sb.AppendLine("@@@@@@@@@@ ITEM $i ERROR: " + $_.Exception.Message + " @@@@@@@@@@")
            [void]$sb.AppendLine("")
        }
        if (($i % 25) -eq 0) {
            Write-Output ("processed " + $i)
        }
    }
} catch {
    Write-Output ("FATAL: " + $_.Exception.Message)
}

Set-Content -Path 'Q:\CodeGuru\scripts\inbox_dump.txt' -Value $sb.ToString() -Encoding UTF8
Write-Output ("DONE total=" + $c + " bytes=" + $sb.Length)
