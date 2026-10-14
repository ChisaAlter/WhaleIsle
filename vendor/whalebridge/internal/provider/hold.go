package provider

import (
	"slices"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/filememo"
	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/settings"
)

// The catalog is rebuilt from every provider's files on each Resolve (tens
// of milliseconds with a few hundred models), and a page of the GUI
// resolves a model for each row: /api/state and /api/groups took 4s and
// 7s with 24 providers. A request that only reads holds the catalog it
// built first for all its look-ups.
var held struct {
	sync.Mutex
	holds int
	gen   uint64
	// what was built, and when, by what it is
	built map[string]heldValue
}

type heldValue struct {
	v  any
	at time.Time
}

func init() {
	catalog.Forget = Changed
	// a plugin's sign-in saved or renewed, a plugin added
	plugin.OnChange(Changed)
}

// heldFor is how long a held catalog is used before it is built again,
// while one request after another keeps it held.
const heldFor = time.Second

// Hold keeps the catalog built once until release is called, for a
// request that only reads; a write meanwhile (Changed) drops it.
func Hold() (release func()) {
	held.Lock()
	held.holds++
	held.Unlock()
	return sync.OnceFunc(func() {
		held.Lock()
		if held.holds--; held.holds == 0 {
			held.built = nil
		}
		held.Unlock()
	})
}

// Changed drops what is held: a provider, an account, a plugin or a
// setting was written.
func Changed() {
	filememo.Forget()
	held.Lock()
	held.gen++
	held.built = nil
	held.Unlock()
}

// heldOf is what build gives, built once while a request holds it.
func heldOf[T any](key string, build func() T) T {
	held.Lock()
	if held.holds == 0 {
		held.Unlock()
		return build()
	}
	if h, ok := held.built[key]; ok && time.Since(h.at) < heldFor {
		held.Unlock()
		return h.v.(T)
	}
	gen := held.gen
	held.Unlock()
	v := build()
	held.Lock()
	if held.holds > 0 && held.gen == gen {
		if held.built == nil {
			held.built = map[string]heldValue{}
		}
		held.built[key] = heldValue{v, time.Now()}
	}
	held.Unlock()
	return v
}

func heldEntries(build func() []Entry) []Entry {
	// clipped: a caller's append copies
	return heldOf("entries", func() []Entry { return slices.Clip(build()) })
}

// heldPlugins is plugin.Cached, which reads the plugins' list and
// sign-ins each time, and PluginOf asks for every model.
func heldPlugins() []plugin.Provider {
	return heldOf("plugins", func() []plugin.Provider { return slices.Clip(plugin.Cached()) })
}

// heldSettings is the settings, read once while a request holds the
// catalog: a look at the agents asks them for every model of every agent.
// Only for reading — what it gives is shared by the request's look-ups.
func heldSettings() settings.Settings { return heldOf("settings", settings.Load) }

// HeldSettings is the settings as heldSettings reads them, for a look
// outside the package made many times in one request.
func HeldSettings() settings.Settings { return heldSettings() }
