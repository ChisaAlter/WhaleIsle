param([long]$WindowHandle, [string]$OutputPath, [switch]$SampleBackdrop)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class NativeCorners {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 public struct RECT { public int Left,Top,Right,Bottom; }
}
'@
[NativeCorners]::SetProcessDPIAware() | Out-Null
$cornerRect=New-Object NativeCorners+RECT
if (-not [NativeCorners]::GetWindowRect([IntPtr]$WindowHandle,[ref]$cornerRect)) { throw 'GetWindowRect failed' }
$cornerBitmap=New-Object System.Drawing.Bitmap(($cornerRect.Right-$cornerRect.Left+16),($cornerRect.Bottom-$cornerRect.Top+16))
$cornerGraphics=[System.Drawing.Graphics]::FromImage($cornerBitmap)
$cornerGraphics.CopyFromScreen($cornerRect.Left-8,$cornerRect.Top-8,0,0,$cornerBitmap.Size)
$cornerSheet=New-Object System.Drawing.Bitmap(256,64)
$cornerSheetGraphics=[System.Drawing.Graphics]::FromImage($cornerSheet)
$cornerResults=@()
foreach ($cornerIndex in 0..3) {
 $cornerRight=($cornerIndex % 2) -eq 1
 $cornerBottom=$cornerIndex -ge 2
 $cornerSourceX=if ($cornerRight) { $cornerBitmap.Width-64 } else { 0 }
 $cornerSourceY=if ($cornerBottom) { $cornerBitmap.Height-64 } else { 0 }
 $cornerSource=New-Object System.Drawing.Rectangle($cornerSourceX,$cornerSourceY,64,64)
 $cornerDest=New-Object System.Drawing.Rectangle(($cornerIndex*64),0,64,64)
 $cornerSheetGraphics.DrawImage($cornerBitmap,$cornerDest,$cornerSource,[System.Drawing.GraphicsUnit]::Pixel)
 foreach ($cornerInset in 0..4) {
  $cornerX=if ($cornerRight) { $cornerBitmap.Width-9-$cornerInset } else { 8+$cornerInset }
  $cornerY=if ($cornerBottom) { $cornerBitmap.Height-9-$cornerInset } else { 8+$cornerInset }
  $cornerPixel=$cornerBitmap.GetPixel($cornerX,$cornerY)
  $cornerDelta=[Math]::Max([Math]::Abs($cornerPixel.R-208),[Math]::Max([Math]::Abs($cornerPixel.G-32),[Math]::Abs($cornerPixel.B-208)))
  $cornerResults+=@{kind='cutout';corner=$cornerIndex;inset=$cornerInset;rgb=@($cornerPixel.R,$cornerPixel.G,$cornerPixel.B);delta=$cornerDelta}
 }
 # A hidden or occluded test window must not pass just because the backdrop is visible.
 $cornerInsideX=if ($cornerRight) { $cornerBitmap.Width-49 } else { 48 }
 $cornerInsideY=if ($cornerBottom) { $cornerBitmap.Height-49 } else { 48 }
 $cornerInside=$cornerBitmap.GetPixel($cornerInsideX,$cornerInsideY)
 $cornerInsideDelta=[Math]::Max([Math]::Abs($cornerInside.R-208),[Math]::Max([Math]::Abs($cornerInside.G-32),[Math]::Abs($cornerInside.B-208)))
 $cornerResults+=@{kind='inside';corner=$cornerIndex;rgb=@($cornerInside.R,$cornerInside.G,$cornerInside.B);delta=$cornerInsideDelta}
}
if ($SampleBackdrop) {
 $middleX=[int][Math]::Floor($cornerBitmap.Width / 2)
 $middleY=[int][Math]::Floor($cornerBitmap.Height / 2)
 foreach ($offset in @(-12, 12)) {
  $pixel=$cornerBitmap.GetPixel($middleX+$offset,$middleY)
  $cornerResults+=@{kind='backdrop';offset=$offset;rgb=@($pixel.R,$pixel.G,$pixel.B)}
 }
}
$cornerSheet.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
$cornerSheetGraphics.Dispose();$cornerSheet.Dispose();$cornerGraphics.Dispose();$cornerBitmap.Dispose()
$cornerResults | ConvertTo-Json -Compress
