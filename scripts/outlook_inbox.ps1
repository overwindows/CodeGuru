$ErrorActionPreference = 'Continue'
$ol = [activator]::CreateInstance([type]::GetTypeFromProgID('Outlook.Application'))
$ns = $ol.GetNamespace('MAPI')

function DumpItems($folder, $folderPath) {
    Write-Output ("===== {0} =====" -f $folderPath)
    try {
        $items = $folder.Items
        $count = $items.Count
        Write-Output ("Count={0}" -f $count)
        for ($i = 1; $i -le $count; $i++) {
            try {
                $it = $items.Item($i)
                $cls = $it.ItemClass
                $subj = $it.Subject
                $from = $it.SenderEmailAddress
                $fromName = $it.SenderName
                $rt = $it.ReceivedTime
                $to = $it.To
                Write-Output ("[{0}] {1} | {2} | from={3} ({4}) | to={5} | recv={6}" -f $i, $cls, $subj, $fromName, $from, $to, $rt)
            } catch {
                Write-Output ("[{0}] <err> {1}" -f $i, $_.Exception.Message)
            }
        }
    } catch {
        Write-Output ("<folder err> {0}" -f $_.Exception.Message)
    }
}

DumpItems $ns.GetDefaultFolder(6) "Inbox"        # Inbox
DumpItems $ns.GetDefaultFolder(5) "Sent Items"   # Sent
