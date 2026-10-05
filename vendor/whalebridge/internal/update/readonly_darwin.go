package update

import "golang.org/x/sys/unix"

// readOnly reports whether path is on a read-only volume, as a mounted
// disk image is.
func readOnly(path string) bool {
	var st unix.Statfs_t
	return unix.Statfs(path, &st) == nil && st.Flags&unix.MNT_RDONLY != 0
}
