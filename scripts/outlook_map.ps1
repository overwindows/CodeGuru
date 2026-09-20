$ErrorActionPreference = 'Continue'
$ol = [activator]::CreateInstance([type]::GetTypeFromProgID('Outlook.Application'))
$ns = $ol.GetNamespace('MAPI')

function WalkFolder($folder, $depth) {
    $indent = '  ' * $depth
    $count = 0
    try { $count = $folder.Items.Count } catch { $count = -1 }
    Write-Output ("{0}| {1} [items={2}]" -f $indent, $folder.Name, $count)
    try {
        foreach ($sub in $folder.Folders) {
            WalkFolder $sub ($depth + 1)
        }
    } catch {
        Write-Output ("{0}|   <error recursing>" -f $indent)
    }
}

foreach ($f in $ns.Folders) {
    WalkFolder $f 0
}
