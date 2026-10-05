package usage

import (
	"fmt"
	"os"
	"syscall"
)

// ctime changes even when a writer restores the size and modification time.
func logChangeStamp(info os.FileInfo) string {
	if info == nil {
		return ""
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	return fmt.Sprintf("%d:%d", stat.Ctim.Sec, stat.Ctim.Nsec)
}
