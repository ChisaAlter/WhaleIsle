// WhaleBridge is the DSH component derived from Magpie.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/yetone/magpie/internal/claudebridge"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/whalebridge"
)

var version = "dev"

func main() {
	if provider.TookOpenedURL(os.Args[1:]) {
		return
	}
	var err error
	if len(os.Args) > 1 && os.Args[1] == "claude-mcp-helper" {
		err = claudebridge.RunMCP(os.Args[2:])
	} else if len(os.Args) == 2 && os.Args[1] == "whalebridge-status" {
		var status whalebridge.ProfileStatus
		status, err = whalebridge.Inspect(os.Getenv("WHALEBRIDGE_DSH_HOME"))
		if err == nil {
			err = json.NewEncoder(os.Stdout).Encode(status)
		}
	} else if len(os.Args) == 2 && os.Args[1] == "whalebridge-disconnect" {
		err = whalebridge.Disconnect(os.Getenv("WHALEBRIDGE_DSH_HOME"))
	} else if len(os.Args) == 2 && os.Args[1] == "whalebridge" {
		err = whalebridge.Run(version)
	} else {
		err = fmt.Errorf("用法: WhaleBridge whalebridge | whalebridge-status | whalebridge-disconnect")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
