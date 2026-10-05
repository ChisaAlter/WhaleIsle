package sessions

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

const crossDeviceErr = windows.ERROR_NOT_SAME_DEVICE

func copySymlink(target, to string, fi os.FileInfo) error {
	linkError := func(err error) error {
		return &os.LinkError{Op: "symlink", Old: target, New: to, Err: err}
	}
	name, err := windowsSymlinkPath(to)
	if err != nil {
		return linkError(err)
	}
	n, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return linkError(err)
	}
	oldname := filepath.FromSlash(target)
	if filepath.IsAbs(oldname) && len(oldname) >= 248 {
		oldname, err = windowsSymlinkPath(oldname)
		if err != nil {
			return linkError(err)
		}
	}
	o, err := windows.UTF16PtrFromString(oldname)
	if err != nil {
		return linkError(err)
	}
	// Lstat keeps the link's directory attribute even when its target is
	// missing. os.Symlink would guess from the target at the new location.
	var flags uint32
	if fi.Sys().(*syscall.Win32FileAttributeData).FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		flags |= windows.SYMBOLIC_LINK_FLAG_DIRECTORY
	}
	const allowUnprivilegedCreate = 0x2 // supported with Windows Developer Mode
	err = windows.CreateSymbolicLink(n, o, flags|allowUnprivilegedCreate)
	if err != nil {
		// As os.Symlink does, retry without the flag for older Windows builds.
		err = windows.CreateSymbolicLink(n, o, flags)
	}
	if err != nil {
		return linkError(err)
	}
	return nil
}

// Native link creation needs an absolute extended path to keep the long-path
// support os.Symlink provides. Relative targets must remain relative.
func windowsSymlinkPath(path string) (string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(path, `\\?\`) || strings.HasPrefix(path, `\\.\`) {
		return path, nil
	}
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC\` + path[2:], nil
	}
	return `\\?\` + path, nil
}
