package proc

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// FindTool is the command-line tool name as a terminal would run it: on
// PATH, else in one of the folders a user's tools are installed in
// (UserBinDirs), else, on Windows, on the PATH the registry has now, which
// a magpie started before the tool was installed doesn't have (#839: the
// Claude sign-in said Claude Code wasn't installed, its installer having
// put claude.exe in ~/.local/bin after magpie started). "" when none.
func FindTool(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	dirs := UserBinDirs()
	if runtime.GOOS == "windows" {
		dirs = append(dirs, LoginPath()...)
	}
	return toolIn(name, runtime.GOOS, dirs)
}

// toolIn is name's program in the first of dirs that has one: on Windows
// name.exe, name.cmd or name, as npm's shim or an installer's binary.
func toolIn(name, goos string, dirs []string) string {
	names := []string{name}
	if goos == "windows" {
		names = []string{name + ".exe", name + ".cmd", name}
	}
	for _, d := range dirs {
		if d == "" {
			continue
		}
		for _, n := range names {
			p := filepath.Join(d, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return ""
}
