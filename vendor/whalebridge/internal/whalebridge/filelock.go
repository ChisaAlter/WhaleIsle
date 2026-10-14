package whalebridge

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

var lockPID = regexp.MustCompile(`^[1-9][0-9]*\n$`)

func lockHolderExited(record []byte) bool {
	if !lockPID.Match(record) {
		return false
	}
	pid, err := strconv.ParseInt(string(bytes.TrimSpace(record)), 10, 32)
	return err == nil && int(pid) != os.Getpid() && holderExited(int(pid))
}

// Use DSH's PID record and takeover claim protocol, never remove a live or
// incomplete writer lock. Contention is reported instead of silently racing.
func acquireFileLock(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	lockPath := path + ".lock"
	create := func() (*os.File, error) { return os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600) }
	f, err := create()
	if err != nil {
		record, readErr := os.ReadFile(lockPath)
		if readErr != nil || !lockHolderExited(record) {
			return nil, fmt.Errorf("DSH 配置正在编辑或锁不可用: %w", err)
		}
		digest := sha256.Sum256(record)
		claim := fmt.Sprintf("%s.takeover-%x", lockPath, digest[:8])
		owned, claimErr := os.OpenFile(claim, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if claimErr != nil {
			return nil, fmt.Errorf("DSH 配置锁正在恢复: %w", claimErr)
		}
		owned.Close()
		defer os.Remove(claim)
		current, readErr := os.ReadFile(lockPath)
		if readErr != nil || !bytes.Equal(current, record) || !lockHolderExited(current) {
			return nil, fmt.Errorf("DSH 配置锁已变化，请重试保存")
		}
		if err := os.Remove(lockPath); err != nil {
			return nil, err
		}
		f, err = create()
		if err != nil {
			return nil, err
		}
	}
	if _, err := fmt.Fprintf(f, "%d\n", os.Getpid()); err != nil {
		f.Close()
		os.Remove(lockPath)
		return nil, err
	}
	if err := f.Close(); err != nil {
		os.Remove(lockPath)
		return nil, err
	}
	return func() { _ = os.Remove(lockPath) }, nil
}

func lockDSHFiles(home string) (func(), error) {
	var held []func()
	release := func() {
		for i := len(held) - 1; i >= 0; i-- {
			held[i]()
		}
	}
	for _, path := range []string{filepath.Join(filepath.Dir(profilePath(home)), "package.json"), filepath.Join(home, "cordis.patch.yml"), filepath.Join(home, ".credentials.yaml")} {
		unlock, err := acquireFileLock(path)
		if err != nil {
			release()
			return nil, err
		}
		held = append(held, unlock)
	}
	return release, nil
}
