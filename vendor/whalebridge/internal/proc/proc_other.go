//go:build !windows

package proc

import "os/exec"

// hide has nothing to do: only Windows gives a child a window of its own.
func hide(*exec.Cmd) {}
