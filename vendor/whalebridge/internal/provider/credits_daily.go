package provider

// How many of its credits a WorkBuddy account used each day (#568).
// WorkBuddy's meter tells only what the cycle has used so far against what
// it grants ("500.52 / 5600"), the built-in's and its plugin's card alike,
// so each reading of it is kept beside the one before, and what was used
// in between is counted on the day of the later one. That is the whole of
// it while magpie reads the meter (whenever the Usage page, the tray or
// routing asks, a minute apart at most); what is used while it doesn't is
// counted on the day it next does.
//
// A reading that has used less than the one before is a cycle started
// again or a credit pack gone: what was used between the two can't be
// told apart from what went, so nothing is counted for it and the new
// reading is where counting goes on from. A pack added (a check-in's
// credits, one bought) only grows what is granted, which counts nothing.
//
// Kept in credits-daily.json, by provider and account name, the readings
// and the days' sums only — no token, nothing of the vendor's but the two
// figures.

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/filememo"
)

// DailyCredits is what an account's credits went to day by day.
type DailyCredits struct {
	// Since is the day magpie first read the account's credits: the days
	// before it aren't known, not unused.
	Since string `json:"since"`
	// Days are the days of the last creditsShown with credits used, oldest
	// first.
	Days []DayCredits `json:"days"`
}

// DayCredits is one day's credits used ("2006-01-02", the local day).
type DayCredits struct {
	Day  string  `json:"day"`
	Used float64 `json:"used"`
}

const (
	creditsKept  = 400 // days kept in the file
	creditsShown = 120 // days a card is told of
)

type creditsReading struct {
	Used  float64   `json:"used"`
	Total float64   `json:"total"`
	At    time.Time `json:"at"`
}

type creditsAccount struct {
	Since string             `json:"since"`
	Last  creditsReading     `json:"last"`
	Days  map[string]float64 `json:"days,omitempty"`
}

// creditsMu keeps two readings in one magpie from writing the file at once;
// each reads it afresh, so another magpie's (the CLI's) is kept too.
var creditsMu sync.Mutex

func creditsPath() string { return filepath.Join(filepath.Dir(Path()), "credits-daily.json") }

func parseCredits(b []byte) (map[string]*creditsAccount, error) {
	accts := map[string]*creditsAccount{}
	if err := json.Unmarshal(b, &accts); err != nil || accts == nil {
		return map[string]*creditsAccount{}, nil
	}
	return accts, nil
}

// creditsCounted says whether q's credits are counted by the day:
// WorkBuddy's, either build, built-in or its plugin's.
func creditsCounted(q SubscriptionQuota) bool {
	return q.Provider == wbCN.id || q.Provider == wbAI.id || strings.HasPrefix(q.Provider, wbCN.id+"-")
}

func creditsKey(q SubscriptionQuota) string {
	return q.Provider + "|" + strings.ToLower(q.User)
}

var creditsDisplay = regexp.MustCompile(`^\s*([\d.,]+)\s*/\s*([\d.,]+)\s*$`)

// creditsOf is what q's credits window says: used and granted.
func creditsOf(q SubscriptionQuota) (used, total float64, ok bool) {
	if q.Error != "" || q.AsOf != nil {
		return 0, 0, false // a reading kept from before isn't a new one
	}
	for _, w := range q.Windows {
		if w.Name != "Credits" {
			continue
		}
		m := creditsDisplay.FindStringSubmatch(w.Display)
		if m == nil {
			return 0, 0, false
		}
		u, err1 := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", ""), 64)
		t, err2 := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", ""), 64)
		if err1 != nil || err2 != nil || t <= 0 {
			return 0, 0, false
		}
		return u, t, true
	}
	return 0, 0, false
}

// noteDailyCredits keeps the WorkBuddy accounts' readings among qs, made
// at now, and counts what each used since its last.
func noteDailyCredits(qs []SubscriptionQuota, now time.Time) {
	creditsMu.Lock()
	defer creditsMu.Unlock()
	path := creditsPath()
	accts := map[string]*creditsAccount{}
	if b, err := os.ReadFile(path); err == nil {
		accts, _ = parseCredits(b)
	}
	day := now.Local().Format("2006-01-02")
	changed := false
	for _, q := range qs {
		if !creditsCounted(q) {
			continue
		}
		used, total, ok := creditsOf(q)
		if !ok {
			continue
		}
		key := creditsKey(q)
		a := accts[key]
		if a == nil {
			a = &creditsAccount{Since: day}
			accts[key] = a
			a.Last = creditsReading{Used: used, Total: total, At: now}
			changed = true
			continue
		}
		if used == a.Last.Used && total == a.Last.Total {
			continue
		}
		if d := used - a.Last.Used; d > 0 {
			if a.Days == nil {
				a.Days = map[string]float64{}
			}
			a.Days[day] = math.Round((a.Days[day]+d)*100) / 100
		}
		a.Last = creditsReading{Used: used, Total: total, At: now}
		changed = true
	}
	if !changed {
		return
	}
	cut := now.Local().AddDate(0, 0, -creditsKept).Format("2006-01-02")
	for _, a := range accts {
		for d := range a.Days {
			if d < cut {
				delete(a.Days, d)
			}
		}
	}
	b, err := json.MarshalIndent(accts, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = writeFileAtomic(path, b)
}

// withDailyCredits gives each WorkBuddy card in qs its days, as kept.
func withDailyCredits(qs []SubscriptionQuota, now time.Time) []SubscriptionQuota {
	if !slices.ContainsFunc(qs, creditsCounted) {
		return qs
	}
	// read only: the parse is shared until the file changes
	accts, err := filememo.Read("credits-daily", creditsPath(), parseCredits)
	if err != nil {
		return qs
	}
	cut := now.Local().AddDate(0, 0, -creditsShown).Format("2006-01-02")
	out := slices.Clone(qs)
	for i, q := range out {
		a := accts[creditsKey(q)]
		if !creditsCounted(q) || a == nil {
			continue
		}
		d := &DailyCredits{Since: a.Since, Days: []DayCredits{}}
		for day, used := range a.Days {
			if day >= cut && used > 0 {
				d.Days = append(d.Days, DayCredits{Day: day, Used: used})
			}
		}
		slices.SortFunc(d.Days, func(x, y DayCredits) int { return strings.Compare(x.Day, y.Day) })
		out[i].Daily = d
	}
	return out
}
