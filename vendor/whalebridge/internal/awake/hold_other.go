//go:build !darwin && !linux && !windows

package awake

import "errors"

func takeHold(bool) (func(), error) { return nil, errors.New("not on this system") }
