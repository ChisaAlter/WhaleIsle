//go:build !windows

package whalebridge

import (
	"os"
	"syscall"
)

func holderExited(pid int) bool {
	process, err := os.FindProcess(pid)
	return err == nil && process.Signal(syscall.Signal(0)) == syscall.ESRCH
}
