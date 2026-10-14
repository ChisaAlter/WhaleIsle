package provider

import (
	"testing"
	"time"

	"github.com/yetone/magpie/internal/plugin"
)

// A refusal for a model counted by a pool of some models only is that
// model's, not the account's: Cursor's Other Models used up leaves Auto in
// Cursor Models (Xiaopodev on X), Opus's own week leaves Sonnet; one of
// the whole account's windows used up is the account's.
func TestAllowancePooled(t *testing.T) {
	now := time.Now()
	month := now.Add(20 * 24 * time.Hour)
	pool := map[string]bool{"auto": true, "composer-2": true}
	q := quotaOfPlugin(SubscriptionQuota{}, plugin.Usage{Windows: []plugin.UsageWindow{
		{Name: "Cursor Models", Used: 12, Models: []string{"auto", "composer-2"}},
		{Name: "Other Models", Used: 100, NotModels: []string{"auto", "composer-2"}},
		{Name: "Total", Used: 60, Aside: true},
	}})
	cursor := allowanceOf(q.Windows, now)
	for _, m := range []string{"auto", "composer-2", "claude-4.6-sonnet", "gpt-5.5"} {
		if !cursor.Pooled(m, 100, now) {
			t.Errorf("Cursor: %s refused isn't the model's alone", m)
		}
		if used, _ := cursor.For(m, now); (used == 100) == pool[m] {
			t.Errorf("Cursor: %s used %v", m, used)
		}
	}

	claude := Allowance{
		{Used: 100, Resets: month, Span: 7 * 24 * time.Hour, Model: "opus"},
		{Used: 40, Resets: month, Span: 7 * 24 * time.Hour},
	}
	if !claude.Pooled("claude-opus-4-7", 100, now) {
		t.Error("Opus's own week used up rests the account")
	}
	if claude.Pooled("claude-sonnet-4-6", 100, now) {
		t.Error("Sonnet, refused with no pool of its full, counts as pooled")
	}
	claude[1].Used = 100
	if claude.Pooled("claude-opus-4-7", 100, now) {
		t.Error("the account's week used up rests only Opus")
	}
	if (Allowance{}).Pooled("auto", 100, now) {
		t.Error("an allowance not known counts as pooled")
	}
}
