$runs = Invoke-RestMethod -Uri 'https://api.github.com/repos/eldoradodesign1/btl-africa-user-registration/actions/runs?per_page=2' -Headers @{ 'User-Agent' = 'pwsh' }
foreach ($r in $runs.workflow_runs) {
  Write-Output ($r.status + ' / ' + $r.conclusion + ' / ' + $r.head_sha.Substring(0, 7) + ' / ' + $r.created_at)
}
