//go:build !windows

package sessions

import (
	"os"
	"syscall"
)

const crossDeviceErr = syscall.EXDEV

func copySymlink(target, to string, _ os.FileInfo) error {
	return os.Symlink(target, to)
}
