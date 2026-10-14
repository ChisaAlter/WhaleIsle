package proc

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000 // CREATE_NO_WINDOW

var getConsoleWindow = syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")

// hasConsole reports whether magpie has a console its children can share:
// the desktop app started from Explorer, a GUI program, has none; one run
// in a terminal, or started from one with a command (console_windows.go
// attaches it then), has. Asked for each command, since that console is
// attached once the program is under way.
var hasConsole = func() bool {
	h, _, _ := getConsoleWindow.Call()
	return h != 0
}

// hide has cmd start with a console of its own that has no window, when
// magpie has no console for it to share. Flags cmd already has are kept.
func hide(cmd *exec.Cmd) {
	if hasConsole() {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
