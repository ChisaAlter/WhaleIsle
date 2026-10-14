//go:build !windows

package proc

import (
	"errors"
	"syscall"
)

func terminate(pid int) error { return signal(pid, syscall.SIGTERM) }

func kill(pid int) error { return signal(pid, syscall.SIGKILL) }

func signal(pid int, s syscall.Signal) error {
	err := syscall.Kill(pid, s)
	if errors.Is(err, syscall.EPERM) {
		return ErrDenied
	}
	if errors.Is(err, syscall.ESRCH) {
		return nil // gone already
	}
	return err
}
