package provider

import (
	"os"
	"strings"

	"github.com/yetone/magpie/internal/proc"
)

// refreshPath takes up the PATH an installer just wrote to the registry,
// which this process, started before it, doesn't have.
func refreshPath() {
	seen := map[string]bool{}
	var path []string
	for _, d := range append(strings.Split(os.Getenv("PATH"), ";"), registryPath()...) {
		if l := strings.ToLower(d); d != "" && !seen[l] {
			seen[l] = true
			path = append(path, d)
		}
	}
	os.Setenv("PATH", strings.Join(path, ";"))
}

// registryPath is the PATH the registry has now (proc.LoginPath).
func registryPath() []string { return proc.LoginPath() }
