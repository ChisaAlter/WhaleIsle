// WhaleBridge is the DSH component derived from Magpie.
package main

import (
	"fmt"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/whalebridge"
	"os"
)

var version = "dev"

func main() {
	if provider.TookOpenedURL(os.Args[1:]) {
		return
	}
	var err error
	if len(os.Args) == 2 && os.Args[1] == "whalebridge-disconnect" {
		err = whalebridge.Disconnect(os.Getenv("WHALEBRIDGE_DSH_HOME"))
	} else if len(os.Args) == 2 && os.Args[1] == "whalebridge" {
		err = whalebridge.Run(version)
	} else {
		err = fmt.Errorf("用法: WhaleBridge whalebridge | whalebridge-disconnect")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
