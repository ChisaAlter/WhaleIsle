//go:build !windows

package usage

import "os"

func statLogFile(path string) (os.FileInfo, error)  { return os.Stat(path) }
func statLogHandle(f *os.File) (os.FileInfo, error) { return f.Stat() }
