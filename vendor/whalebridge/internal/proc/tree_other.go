//go:build !windows

package proc

import (
	"os/exec"
	"syscall"
)

// group is the session the command leads: its children are in it unless
// they make one of their own, and grok's MCP servers do, but those end when
// their input closes with the CLI.
type group struct{}

func ownGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
}

func (group) join(*exec.Cmd) {}

func (group) kill(cmd *exec.Cmd) {
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

// sweep ends what is left of the group once its leader is gone: the group
// keeps the leader's pid while any of it runs, so none else has it.
func (g group) sweep(cmd *exec.Cmd) { g.kill(cmd) }
