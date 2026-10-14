package gateway

import (
	"sync"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// WhaleBridgeQuotaNotice is an alert emitted by subscription maintenance.
// Sequence lets the component poll without showing the same notice twice.
type WhaleBridgeQuotaNotice struct {
	Sequence int64               `json:"sequence"`
	At       time.Time           `json:"at"`
	Alert    provider.QuotaAlert `json:"alert"`
}

type WhaleBridgeQuotaNotices struct {
	Sequence int64                    `json:"sequence"`
	Alerts   []WhaleBridgeQuotaNotice `json:"alerts"`
}

var whaleBridgeQuotaWake = make(chan struct{}, 1)
var whaleBridgeQuotaNotices struct {
	sync.Mutex
	sequence     int64
	nativeCursor int64
	alerts       []WhaleBridgeQuotaNotice
}

// WakeWhaleBridgeQuotaAlerts applies changed reminder settings immediately.
func WakeWhaleBridgeQuotaAlerts() {
	select {
	case whaleBridgeQuotaWake <- struct{}{}:
	default:
	}
}

func recordWhaleBridgeQuotaAlert(alert provider.QuotaAlert) {
	whaleBridgeQuotaNotices.Lock()
	defer whaleBridgeQuotaNotices.Unlock()
	whaleBridgeQuotaNotices.sequence++
	whaleBridgeQuotaNotices.alerts = append(whaleBridgeQuotaNotices.alerts, WhaleBridgeQuotaNotice{
		Sequence: whaleBridgeQuotaNotices.sequence,
		At:       time.Now(),
		Alert:    alert,
	})
	if len(whaleBridgeQuotaNotices.alerts) > 100 {
		whaleBridgeQuotaNotices.alerts = whaleBridgeQuotaNotices.alerts[len(whaleBridgeQuotaNotices.alerts)-100:]
	}
}

// WhaleBridgeAlerts returns new notices and the current poll cursor. The
// provider's persistent alert marks already prevent re-emission on restart.
func WhaleBridgeAlerts(after int64) WhaleBridgeQuotaNotices {
	whaleBridgeQuotaNotices.Lock()
	defer whaleBridgeQuotaNotices.Unlock()
	out := WhaleBridgeQuotaNotices{Sequence: whaleBridgeQuotaNotices.sequence, Alerts: []WhaleBridgeQuotaNotice{}}
	for _, notice := range whaleBridgeQuotaNotices.alerts {
		if notice.Sequence > after {
			out.Alerts = append(out.Alerts, notice)
		}
	}
	return out
}

// ClaimWhaleBridgeAlerts lets the desktop and standalone launcher share one
// native notification delivery cursor. The management history remains intact.
func ClaimWhaleBridgeAlerts() WhaleBridgeQuotaNotices {
	whaleBridgeQuotaNotices.Lock()
	defer whaleBridgeQuotaNotices.Unlock()
	out := WhaleBridgeQuotaNotices{Sequence: whaleBridgeQuotaNotices.sequence, Alerts: []WhaleBridgeQuotaNotice{}}
	for _, notice := range whaleBridgeQuotaNotices.alerts {
		if notice.Sequence > whaleBridgeQuotaNotices.nativeCursor {
			out.Alerts = append(out.Alerts, notice)
		}
	}
	whaleBridgeQuotaNotices.nativeCursor = whaleBridgeQuotaNotices.sequence
	return out
}
