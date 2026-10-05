package sessions

// Carrying a session on in another agent (#845): only where that agent reads
// the session's own file as it is, so nothing is converted, and the file is
// left as it was.
//
// oh-my-pi grew from Pi and reads Pi's sessions: `omp --fork <file>` loads a
// Pi session (its version-3 entries, messages, tool calls and results,
// thinking; the model from its assistant messages, as omp names models
// provider/id) and writes a new omp session from it, the Pi file untouched.
// The other way doesn't work: Pi opens a file only when its first line is
// the session header, and omp's first line is its title. Other agents keep
// their sessions in forms of their own, which would have to be converted.

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Carry is another agent a session can be carried on in, and the shell
// line that does it in the session's folder.
type Carry struct {
	Agent   string `json:"agent"`
	Command string `json:"command"`
}

// ompThere says whether oh-my-pi is installed: its command, or its folder.
// A var so tests can say.
var ompThere = func() bool {
	if _, err := exec.LookPath("omp"); err == nil {
		return true
	}
	_, err := os.Stat(OmpDir())
	return err == nil
}

// carries are the other agents a session can be carried on in.
func carries(s Session) []Carry {
	if s.ReadOnly || s.WSL != "" || s.Path == "" || s.Cwd == "" {
		return nil
	}
	switch s.Agent {
	case "pi":
		if !ompThere() {
			return nil
		}
		return []Carry{{Agent: "omp", Command: inFolder(s.Cwd, "omp --fork "+argQuote(s.Path))}}
	}
	return nil
}

// inFolder is a shell line running run in the folder cwd.
func inFolder(cwd, run string) string {
	if runtime.GOOS == "windows" {
		return "Set-Location -LiteralPath " + argQuote(cwd) + "; " + run
	}
	return "cd " + argQuote(cwd) + " && " + run
}

// argQuote is s as one argument of this system's shell.
func argQuote(s string) string {
	if runtime.GOOS == "windows" {
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return shellQuote(s)
}
