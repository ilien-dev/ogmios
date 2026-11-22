# Draws the images the installers show, from the brand's symbol:
#   src-tauri/windows/logo-<scale>.bmp    the symbol on the installer's pages
#   src-tauri/windows/lockup-<scale>.bmp  symbol and name, atop the progress page
#   src-tauri/macos/dmg-background.png    the window of the macOS disk image
# Run it again when the brand changes:  powershell -File scripts/installer-assets.ps1
Add-Type -AssemblyName System.Drawing

$tauri = Join-Path $PSScriptRoot "..\src-tauri"
$brand = Join-Path $PSScriptRoot "..\assets\brand\logo"

# The installer's page, the line of the symbol and its centre: graphite,
# paper and the app's mint (src/styles/global.css, --color-logo-second).
$dark = [System.Drawing.ColorTranslator]::FromHtml("#0b0c0e")
$paper = [System.Drawing.ColorTranslator]::FromHtml("#f3f2ee")
$mint = [System.Drawing.ColorTranslator]::FromHtml("#4ade9b")

function Hex($colour) { "{0:X2}{1:X2}{2:X2}" -f $colour.R, $colour.G, $colour.B }
"dark $(Hex $dark)  paper $(Hex $paper)  mint $(Hex $mint)"

# The symbol's line and its square on the 256 grid (logo/ogmios-symbol.svg).
$line = @(80,54, 202,54, 202,202, 54,202, 54,98, 158,98, 158,158, 98,158, 98,116,
          72,116, 72,184, 184,184, 184,72, 28,72, 28,228, 228,228, 228,28, 80,28)
$square = @(114, 113, 32, 32)

# Draws the symbol with its grid's top left at ($x, $y), $k pixels per unit.
function Symbol($g, $x, $y, $k) {
    $points = for ($i = 0; $i -lt $line.Count; $i += 2) {
        New-Object System.Drawing.PointF ($x + $line[$i] * $k), ($y + $line[$i + 1] * $k)
    }
    $brush = New-Object System.Drawing.SolidBrush $paper
    $g.FillPolygon($brush, [System.Drawing.PointF[]]$points)
    $brush.Color = $mint
    $g.FillRectangle($brush, $x + $square[0] * $k, $y + $square[1] * $k, $square[2] * $k, $square[3] * $k)
    $brush.Dispose()
}

function Canvas($width, $height) {
    $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($dark)
    return $bitmap, $g
}

# The name, outlined, cut from the horizontal lockup: it starts at x 244 of
# the lockup's 811.2 x 200 (logo/ogmios-horizontal-on-dark.svg).
$horizontal = [System.Drawing.Bitmap]::FromFile((Join-Path $brand "png\ogmios-horizontal-on-dark-1600.png"))
$unit = $horizontal.Width / 811.2
$name = New-Object System.Drawing.RectangleF (244 * $unit), 0, ($horizontal.Width - 244 * $unit), $horizontal.Height

# NSIS stretches a bitmap without smoothing it, so there is one per display
# scale: the symbol 72 px at 100 %, the lockup 32 px high (130 wide).
foreach ($scale in 100, 125, 150, 175, 200) {
    $side = 72 * $scale / 100
    $logo, $g = Canvas $side $side
    Symbol $g 0 0 ($side / 256)
    $g.Dispose()
    $logo.Save((Join-Path $tauri "windows\logo-$scale.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $logo.Dispose()

    $high = 32 * $scale / 100
    $k = $high / 200
    $lockup, $g = Canvas ([int][Math]::Ceiling(811.2 * $k)) $high
    Symbol $g (-28 * $k) (-28 * $k) $k
    $to = New-Object System.Drawing.RectangleF (244 * $k), 0, ((811.2 - 244) * $k), $high
    $g.DrawImage($horizontal, $to, $name, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $lockup.Save((Join-Path $tauri "windows\lockup-$scale.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $lockup.Dispose()
}
$horizontal.Dispose()

# Finder writes the icons' names in black or in white by the system theme, not
# by the picture behind them: a mid graphite is readable under both.
$graphite = [System.Drawing.Color]::FromArgb(110, 113, 124)
$dmg = New-Object System.Drawing.Bitmap 660, 400, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($dmg)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear($graphite)
$pen = New-Object System.Drawing.Pen $mint, 8
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
