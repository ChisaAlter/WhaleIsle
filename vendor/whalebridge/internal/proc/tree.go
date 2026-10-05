package proc

import (
	"os/exec"
	"sync"
)

// A Tree is a started command and the processes it starts in turn: an
// agent's CLI with the MCP servers, shells and helpers it runs. Killing the
// CLI alone leaves those running, so they are ended with it.
type Tree struct {
	cmd *exec.Cmd

	mu   sync.Mutex
	done bool // waited for: its pid may be another process's now
	group
}

// StartTree starts cmd in a group of its own: a session on Unix, a job on
// Windows. It has no terminal then, and a Ctrl+C there doesn't reach it.
func StartTree(cmd *exec.Cmd) (*Tree, error) {
	ownGroup(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	t := &Tree{cmd: cmd}
	t.join(cmd)
	return t, nil
}

// Wait waits for the command, then ends what it left running.
func (t *Tree) Wait() error {
	err := t.cmd.Wait()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.done = true
	t.sweep(t.cmd)
	return err
}

// Kill ends the command and every process of its tree.
func (t *Tree) Kill() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.done {
		return
	}
	t.kill(t.cmd)
	_ = t.cmd.Process.Kill()
}
