# Draws the two images the installers show, from the app icon:
#   src-tauri/windows/logo-<scale>.bmp  the logo on the installer's pages
#   src-tauri/macos/dmg-background.png  the window of the macOS disk image
# Run it again when the icon changes:  powershell -File scripts/installer-assets.ps1
Add-Type -AssemblyName System.Drawing

$tauri = Join-Path $PSScriptRoot "..\src-tauri"
$icon = [System.Drawing.Bitmap]::FromFile((Join-Path $tauri "icons\icon.png"))

# The icon's own colours: its dark square and the gold of the speech bubble.
$dark = $icon.GetPixel($icon.Width / 2, $icon.Height / 20)
$gold = $icon.GetPixel($icon.Width / 4, $icon.Height / 2)

function Hex($colour) { "{0:X2}{1:X2}{2:X2}" -f $colour.R, $colour.G, $colour.B }
"dark $(Hex $dark)  gold $(Hex $gold)"

# The logo sits on a page of the icon's dark colour, so its square disappears
# into the page and only the speech bubble shows. NSIS stretches a bitmap
# without smoothing it, so there is one per display scale, 72 px at 100 %.
foreach ($scale in 100, 125, 150, 175, 200) {
    $side = 72 * $scale / 100
    $logo = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($logo)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($dark)
    $g.DrawImage($icon, 0, 0, $side, $side)
    $g.Dispose()
    $logo.Save((Join-Path $tauri "windows\logo-$scale.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $logo.Dispose()
}

# Finder writes the icons' names in black or in white by the system theme, not
# by the picture behind them: a mid graphite is readable under both.
$graphite = [System.Drawing.Color]::FromArgb(110, 113, 124)
$dmg = New-Object System.Drawing.Bitmap 660, 400, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($dmg)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear($graphite)
$pen = New-Object System.Drawing.Pen $gold, 8
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
# The arrow runs between the two icons, which Tauri centres at x 180 and 480.
$g.DrawLine($pen, 270, 190, 388, 190)
$g.DrawLines($pen, [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point 366, 168),
    (New-Object System.Drawing.Point 390, 190),
    (New-Object System.Drawing.Point 366, 212)))
$g.Dispose()
$dmg.Save((Join-Path $tauri "macos\dmg-background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$dmg.Dispose()
$icon.Dispose()
