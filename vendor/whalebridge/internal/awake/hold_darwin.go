package awake

import (
	"os"
	"strconv"

	"github.com/yetone/magpie/internal/proc"
)

// takeHold runs caffeinate -i, which keeps the Mac from idle sleep while it
// runs, with -d its display from sleeping too; -w ends it with magpie should
// magpie end without letting go.
func takeHold(display bool) (func(), error) {
	cmd := proc.Command("/usr/bin/caffeinate", caffeinateArgs(display, os.Getpid())...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}, nil
}

// caffeinateArgs is what takeHold runs caffeinate with.
func caffeinateArgs(display bool, pid int) []string {
	args := []string{"-i"}
	if display {
		args = append(args, "-d")
	}
	return append(args, "-w", strconv.Itoa(pid))
}
