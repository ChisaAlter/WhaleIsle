//go:build darwin || linux

package gateway

import (
	"syscall"

	"golang.org/x/sys/unix"
)

// syscall has SO_REUSEPORT on darwin but not on linux; x/sys/unix has it on both
func reusePort(_, _ string, c syscall.RawConn) error {
	var err error
	if cerr := c.Control(func(fd uintptr) {
		err = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
	}); cerr != nil {
		return cerr
	}
	return err
}
