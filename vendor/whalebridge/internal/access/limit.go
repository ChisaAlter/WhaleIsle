package access

import (
	"errors"
	"math"
	"time"
)

// Limit is a gateway key's budget for a calendar window in local time
// (#585): a day from midnight, a week from Monday's midnight, a month
// from the 1st's. Tokens counts each call's uncached input, output
// (reasoning included) and cache writes, and its cache reads too when
// CacheReads is set; Cost is an estimate in US dollars at the prices
// magpie shows on the Usage page, not a vendor's bill. A cap of 0 is no
// cap; a limit with neither is no limit.
type Limit struct {
	Period     string  `json:"period"`
	Tokens     int64   `json:"tokens,omitempty"`
	Cost       float64 `json:"cost,omitempty"`
	CacheReads bool    `json:"cacheReads,omitempty"`
}

// Periods are the windows a limit can be set for.
var Periods = []string{"day", "week", "month"}

// Limited: l caps something.
func (l *Limit) Limited() bool { return l != nil && (l.Tokens > 0 || l.Cost > 0) }

// Valid is l as it is kept: nil for no limit, an error for one that
// can't be.
func (l *Limit) Valid() (*Limit, error) {
	if l == nil {
		return nil, nil
	}
	if l.Tokens < 0 || l.Cost < 0 || math.IsNaN(l.Cost) || math.IsInf(l.Cost, 0) {
		return nil, errors.New("A limit can't be negative")
	}
	if !l.Limited() {
		return nil, nil
	}
	v := *l
	if v.Period == "" {
		v.Period = "day"
	}
	switch v.Period {
	case "day", "week", "month":
	default:
		return nil, errors.New("A limit's period is day, week or month")
	}
	v.Cost = math.Round(v.Cost*1e4) / 1e4
	return &v, nil
}

// Window is the calendar window of period that now is in, in now's
// location: its start and when the next begins.
func Window(period string, now time.Time) (start, reset time.Time) {
	y, m, d := now.Date()
	loc := now.Location()
	switch period {
	case "week":
		back := (int(now.Weekday()) + 6) % 7 // days since Monday
		start = time.Date(y, m, d-back, 0, 0, 0, 0, loc)
		return start, time.Date(y, m, d-back+7, 0, 0, 0, 0, loc)
	case "month":
		return time.Date(y, m, 1, 0, 0, 0, 0, loc), time.Date(y, m+1, 1, 0, 0, 0, 0, loc)
	default:
		return time.Date(y, m, d, 0, 0, 0, 0, loc), time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	}
}
