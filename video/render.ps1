# Renders an RsWork video end to end: event times -> music -> PNG frames -> MP4.
# From the repo root:
#   3-minute promo:   powershell -ExecutionPolicy Bypass -File video\render.ps1
#   60-second ad:     powershell -ExecutionPolicy Bypass -File video\render.ps1 -Ad
# If out\voiceover.wav (promo) or out\ad_voiceover.wav (ad) exists, it is mixed in and the
# music ducks under the voice.
param([switch]$Ad)
$ErrorActionPreference = "Stop"
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$here = $PSScriptRoot
$out = Join-Path $here "out"
New-Item -ItemType Directory -Force $out | Out-Null

if ($Ad) { $script = "rswork_ad60.py"; $p = "ad_"; $dur = 60; $mp4 = "$out\RsWork_ad_60s.mp4" }
else     { $script = "rswork_promo.py"; $p = "";   $dur = 180; $mp4 = "$out\RsWork_promo.mp4" }
$frames = if ($Ad) { "$out\ad_frames" } else { "$out\frames" }

& $blender -b -P "$here\$script" -- --events "$out\${p}events.json"
python "$here\make_music.py" "$out\${p}events.json" "$out\${p}music.wav" $dur
# Frames already rendered are skipped, so an interrupted render can be resumed.
& $blender -b -P "$here\$script" -- --render $frames

$vo = "$out\${p}voiceover.wav"
if (Test-Path $vo) {
    ffmpeg -y -framerate 30 -i "$frames\%04d.png" -i "$out\${p}music.wav" -i $vo `
        -filter_complex "[2:a]asplit=2[vo][sc];[1:a]volume=0.8[m];[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=400[bed];[bed][vo]amix=inputs=2:duration=first:normalize=0[a]" `
        -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p `
        -c:a aac -b:a 192k -movflags +faststart $mp4
} else {
    ffmpeg -y -framerate 30 -i "$frames\%04d.png" -i "$out\${p}music.wav" `
        -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k `
        -shortest -movflags +faststart $mp4
}
Write-Host "Done: $mp4"
