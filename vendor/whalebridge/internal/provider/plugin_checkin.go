package provider

// A plugin's own daily check-in (Lemon on Discord: provider 每日签到的方法能
// 放到插件里面去做吗): a plugin whose auth hook has checkin presses its
// vendor's 签到 itself, and magpie runs it as it runs its own check-ins
// (checkin.go): each account in use once a Beijing day while the user has
// it on, a failure tried again later that day, what came of it on the
// account's Usage card and in Settings. A plugin that checks in takes over
// from magpie's own check-in through its fetch (WorkBuddy, Trae CN,
// MiniMax Code, Qoder), so an account is never checked in twice.
//
// What came of it is kept in plugin-checkin.json by provider and account.

import (
	"context"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/settings"
)

// pluginCheckinBy is the WorkBuddyCheckin.By of a plugin's check-in.
func pluginCheckinBy(id string) string { return "plugin:" + id }

func pluginCheckinPath() string { return filepath.Join(filepath.Dir(Path()), "plugin-checkin.json") }

var pluginCheckinMu sync.Mutex

// pluginCheckinAcct is a plugin's account checked in.
type pluginCheckinAcct struct {
	User string
	On   bool
	key  string // provider|account
	card string
	do   func(context.Context) WorkBuddyCheckin
}

// pluginCheckinProvider is a plugin's provider that checks in, and its
// accounts.
type pluginCheckinProvider struct {
	ID, Name string
	accounts []pluginCheckinAcct
}

// pluginCheckinProviders are the plugins' providers whose plugin checks
// in, those signed in to.
var pluginCheckinProviders = func() []pluginCheckinProvider {
	var out []pluginCheckinProvider
	for _, pp := range heldPlugins() {
		if !pp.Checkin || movingNow(pp.ID) {
			continue
		}
		p := pluginCheckinProvider{ID: pp.ID, Name: pp.Name}
		card := PluginID(pp.ID)
		for _, l := range pluginLogins(pp) {
			acct := l.acct.Key
			who := l.acct.AccountID
			if who == "" {
				who = acct
			}
			id := pp.ID
			p.accounts = append(p.accounts, pluginCheckinAcct{User: l.User, On: l.On, key: id + "|" + who, card: card,
				do: func(ctx context.Context) WorkBuddyCheckin {
					c, err := plugin.AccountCheckin(ctx, id, acct)
					if err != nil {
						return wbCheckinFailed(err)
					}
					return WorkBuddyCheckin{Outcome: c.Outcome, Credit: c.Credit, Streak: c.Streak, Msg: c.Message}
				}})
		}
		if len(p.accounts) > 0 {
			out = append(out, p)
		}
	}
	return out
}

// pluginChecksIn says whether pp's plugin presses the check-in itself:
// magpie's own check-in through its fetch leaves its accounts to it.
func pluginChecksIn(pp plugin.Provider) bool { return pp.Checkin }

// PluginCheckinOn says whether a plugin provider's accounts are checked in
// each day: as the user set it for the provider, else as the built-in
// check-in of its vendor is set, which the plugin took over.
func PluginCheckinOn(s settings.Settings, id string) bool {
	if on, ok := s.PluginCheckins[id]; ok {
		return on
	}
	switch id {
	case wbCN.id:
		return s.WorkBuddyCheckin
	case TraeCNID:
		return s.TraeCheckin
	case MiniMaxCodeID, MiniMaxCodeGlobalID:
		return s.MiniMaxCheckin
	case "qoder", QoderCNID:
		return s.QoderCheckin
	}
	return false
}

func (p pluginCheckinProvider) checkiner(now func() time.Time) checkiner {
	return checkiner{path: pluginCheckinPath(), now: now, mu: &pluginCheckinMu, by: pluginCheckinBy(p.ID), label: p.ID, accounts: func() []checkinAcct {
		var out []checkinAcct
		for _, a := range p.accounts {
			out = append(out, checkinAcct{User: a.User, On: a.On, key: a.key, do: a.do})
		}
		return out
	}}
}

// pluginCheckiner checks in the plugins' accounts: of those whose
// provider only says, all of them when only is nil.
type pluginCheckiner struct {
	now  func() time.Time
	only func(id string) bool
}

func (c pluginCheckiner) clock() time.Time { return c.now() }

func (c pluginCheckiner) checkinNow(ctx context.Context, soon bool) []WorkBuddyCheckin {
	var out []WorkBuddyCheckin
	for _, p := range pluginCheckinProviders() {
		if c.only != nil && !c.only(p.ID) {
			continue
		}
		for _, r := range p.checkiner(c.now).checkinNow(ctx, soon) {
			r.Vendor = p.Name
			out = append(out, r)
		}
	}
	return out
}

// CheckInPlugins checks the accounts of each plugin that checks in in for
// today now, those not in yet; with ids, only those providers'. It says
// how each stands.
func CheckInPlugins(ctx context.Context, ids ...string) []WorkBuddyCheckin {
	c := pluginCheckiner{now: time.Now}
	if len(ids) > 0 {
		c.only = func(id string) bool {
			for _, x := range ids {
				if x == id {
					return true
				}
			}
			return false
		}
	}
	return c.checkinNow(ctx, true)
}

// PluginCheckin is a plugin's provider that checks in, for Settings: its
// switch and how each account's last check-in went.
type PluginCheckin struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	On       bool               `json:"on"`
	Checkins []WorkBuddyCheckin `json:"checkins,omitempty"`
}

// PluginCheckins are the plugins' providers that check in, each with its
// accounts' last check-ins as kept; asks nothing.
func PluginCheckins() []PluginCheckin {
	st := readCheckins(pluginCheckinPath())
	s := settings.Load()
	var out []PluginCheckin
	for _, p := range pluginCheckinProviders() {
		pc := PluginCheckin{ID: p.ID, Name: p.Name, On: PluginCheckinOn(s, p.ID)}
		listed := map[string]bool{}
		for _, a := range p.accounts {
			if r, ok := st[a.key]; ok && a.On && !listed[a.key] {
				listed[a.key] = true
				r.User, r.By, r.Vendor = a.User, pluginCheckinBy(p.ID), p.Name
				pc.Checkins = append(pc.Checkins, r)
			}
		}
		sort.SliceStable(pc.Checkins, func(i, j int) bool { return pc.Checkins[i].User < pc.Checkins[j].User })
		out = append(out, pc)
	}
	return out
}

// HasPluginCheckin says whether a plugin that checks in is signed in.
func HasPluginCheckin() bool { return len(pluginCheckinProviders()) > 0 }

// pluginCheckinMarks is qs with the cards of the plugins' accounts that
// check in marked, as WithCheckins marks the built-ins'.
func pluginCheckinMarks(qs []SubscriptionQuota) []SubscriptionQuota {
	ps := pluginCheckinProviders()
	if len(ps) == 0 {
		return qs
	}
	st := readCheckins(pluginCheckinPath())
	for _, p := range ps {
		var on []checkinCard
		for _, a := range p.accounts {
			if a.On {
				on = append(on, checkinCard{User: a.User, card: a.card, key: a.key})
			}
		}
		qs = markCheckins(qs, on, st, pluginCheckinBy(p.ID))
	}
	return qs
}

// KeepPluginsCheckedIn checks the plugins' accounts in each day, each
// provider's while settings say to, as KeepWorkBuddyCheckedIn does
// WorkBuddy's.
func KeepPluginsCheckedIn(ctx context.Context) {
	c := pluginCheckiner{now: time.Now, only: func(id string) bool { return PluginCheckinOn(settings.Load(), id) }}
	keepCheckedIn(ctx, "plugin", c, func() bool { return true })
}
