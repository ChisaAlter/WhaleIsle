//go:build !darwin

package update

func readOnly(string) bool { return false }
