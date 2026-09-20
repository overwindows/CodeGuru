$ErrorActionPreference = 'Continue'
$ol = [activator]::CreateInstance([type]::GetTypeFromProgID('Outlook.Application'))
$ns = $ol.GetNamespace('MAPI')

function ItemStats($folder, $path) {
    try {
        $items = $folder.Items
        $c = $items.Count
        $min = $null; $max = $null
        for ($i=1; $i -le $c; $i++) {
            try {
                $rt = $items.Item($i).ReceivedTime
                if ($rt -ne $null) {
                    if ($min -eq $null -or $rt -lt $min) { $min = $rt }
                    if ($max -eq $null -or $rt -gt $max) { $max = $rt }
                }
            } catch {}
        }
        $minS = if ($min) { $min.ToString('yyyy-MM-dd') } else { '-' }
        $maxS = if ($max) { $max.ToString('yyyy-MM-dd') } else { '-' }
        Write-Output ("{0} | items={1} | range={2}..{3}" -f $path, $c, $minS, $maxS)
    } catch {
        Write-Output ("{0} | <err {1}>" -f $path, $_.Exception.Message)
    }
}

# Inbox root and all its subfolders
$inbox = $ns.GetDefaultFolder(6)
ItemStats $inbox "Inbox"
foreach ($sub in $inbox.Folders) {
    ItemStats $sub ("Inbox/" + $sub.Name)
    foreach ($sub2 in $sub.Folders) {
        ItemStats $sub2 ("Inbox/" + $sub.Name + "/" + $sub2.Name)
    }
}

# Sent
$sent = $ns.GetDefaultFolder(5)
ItemStats $sent "Sent Items"

# Archive store
$archive = $ns.Folders | Where-Object { $_.Name -like '*Archive*' }
if ($archive) {
    foreach ($a in $archive) {
        ItemStats $a ("ArchiveStore/" + $a.Name)
    }
}
