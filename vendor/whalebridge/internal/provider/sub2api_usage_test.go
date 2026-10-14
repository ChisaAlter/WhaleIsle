package provider

import (
	"bytes"
	"os"
	"testing"
	"time"
)

func sub2apiUsage(t *testing.T, started bool) []byte {
	t.Helper()
	name := "testdata/sub2api_usage_key_limits_not_started.json"
	if started {
		name = "testdata/sub2api_usage_key_limits.json"
	}
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// weekUsed is the started reply with $used of the week spent, its day and
// week resetting a day and three days from now, as a test run on any day
// sees them.
func weekUsed(t *testing.T, used string, week time.Time) []byte {
	t.Helper()
	b := sub2apiUsage(t, true)
	b = bytes.Replace(b, []byte(`"used":0.0000958,"window":"7d"`), []byte(`"used":`+used+`,"window":"7d"`), 1)
	b = bytes.Replace(b, []byte("2026-10-07T00:00:00+08:00"), []byte(time.Now().Add(24*time.Hour).Format(time.RFC3339)), 1)
	return bytes.Replace(b, []byte("2026-10-13T00:00:00+08:00"), []byte(week.Format(time.RFC3339)), 1)
}

// A key given limits answers with its windows' spend in dollars; a
// window not started (or run out since) says used 0 and no reset_at.
func TestReadSub2APIKeyLimits(t *testing.T) {
	ws, ok := readSub2APIKeyLimits(sub2apiUsage(t, true))
	if !ok || len(ws) != 2 {
		t.Fatalf("windows = %+v, %v", ws, ok)
	}
	day, week := ws[0], ws[1]
	reset := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	if day.Name != "1 day" || day.Span != 24*time.Hour || day.Limit != 300 || day.Unit != "USD" ||
		day.ResetsAt == nil || !day.ResetsAt.Equal(reset("2026-10-07T00:00:00+08:00")) ||
		day.Amount != 0.0000958 || day.Used <= 0 || day.Used > 0.0001 {
		t.Fatalf("day = %+v", day)
	}
	if week.Name != "7 days" || week.Span != 7*24*time.Hour || week.Limit != 800 ||
		week.ResetsAt == nil || !week.ResetsAt.Equal(reset("2026-10-13T00:00:00+08:00")) {
		t.Fatalf("week = %+v", week)
	}

	ws, ok = readSub2APIKeyLimits(sub2apiUsage(t, false))
	if !ok || len(ws) != 2 || ws[0].ResetsAt != nil || ws[1].ResetsAt != nil || ws[1].Used != 0 || ws[1].Span != 7*24*time.Hour {
		t.Fatalf("not started = %+v, %v", ws, ok)
	}

	// $720 of the week's $800 is 90%, over it no more than 100
	b := bytes.Replace(sub2apiUsage(t, true), []byte(`"used":0.0000958,"window":"7d"`), []byte(`"used":720,"window":"7d"`), 1)
	if ws, _ = readSub2APIKeyLimits(b); len(ws) != 2 || ws[1].Used != 90 || ws[1].Amount != 720 {
		t.Fatalf("$720 of $800 = %+v", ws)
	}
	b = bytes.Replace(sub2apiUsage(t, true), []byte(`"used":0.0000958,"window":"7d"`), []byte(`"used":812.5,"window":"7d"`), 1)
	if ws, _ = readSub2APIKeyLimits(b); len(ws) != 2 || ws[1].Used != 100 {
		t.Fatalf("$812.50 of $800 = %+v", ws)
	}

	// a window without a limit is none
	b = bytes.Replace(sub2apiUsage(t, true), []byte(`"limit":300`), []byte(`"limit":0`), 1)
	if ws, _ = readSub2APIKeyLimits(b); len(ws) != 1 || ws[0].Name != "7 days" {
		t.Fatalf("a day's limit of 0 = %+v", ws)
	}

	// a key on the wallet has none
	if ws, ok := readSub2APIKeyLimits([]byte(`{"mode":"unrestricted","isValid":true,"planName":"钱包余额","remaining":7.25,"unit":"USD","balance":7.25}`)); ok || ws != nil {
		t.Fatalf("wallet = %+v, %v", ws, ok)
	}
}
