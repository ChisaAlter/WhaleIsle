package usage

import "os"

// Keep native file identity alongside a change time captured from the same
// handle. os.SameFile requires the original os.FileInfo, not this wrapper.
type logFileInfo struct {
	os.FileInfo
	stamp string
}

func sameLogFile(a, b os.FileInfo) bool {
	if wrapped, ok := a.(logFileInfo); ok {
		a = wrapped.FileInfo
	}
	if wrapped, ok := b.(logFileInfo); ok {
		b = wrapped.FileInfo
	}
	return a != nil && b != nil && os.SameFile(a, b)
}
