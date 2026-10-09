package provider

import (
	"encoding/json"
	"os"
	"testing"
)

func TestCodexBackendHeldGate(t *testing.T) {
	read := func(name string) map[string]any {
		t.Helper()
		b, err := os.ReadFile("testdata/" + name)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	with := func(m map[string]any, edit func(m map[string]any)) map[string]any {
		edit(m)
		return m
	}
	credits := func(m map[string]any) map[string]any { return m["credits"].(map[string]any) }
	rateLimit := func(m map[string]any) map[string]any { return m["rate_limit"].(map[string]any) }
	// a workspace on no credits that the app sends for: within its overage,
	// not at a spend cap, held for its allowance alone
	within := func(plan string, edit func(m map[string]any)) map[string]any {
		return with(read("codex_usage_team_spend_cap.json"), func(m map[string]any) {
			m["plan_type"] = plan
			credits(m)["has_credits"] = false
			m["spend_control"] = map[string]any{"reached": false, "individual_limit": nil}
			m["rate_limit_reached_type"] = map[string]any{"type": "rate_limit_reached", "details": nil}
			edit(m)
		})
	}
	as := func(m map[string]any) {}
	for _, c := range []struct {
		name string
		body map[string]any
		want bool
	}{
		{"Pro at 100% on its week, with credits", read("codex_usage_pro_credits.json"), false},
		{"Team at its spend cap, with credits", read("codex_usage_team_spend_cap.json"), false},
		{"Pro at 100%, credits spent", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			credits(m)["has_credits"], credits(m)["balance"] = false, "0"
		}), true},
		{"Pro at 100%, credits unlimited", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			credits(m)["has_credits"], credits(m)["unlimited"] = false, true
		}), false},
		{"Pro at 100%, no credits said", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			delete(m, "credits")
		}), true},
		// the app reads the spend cap and the overage only for a workspace
		// with no credits: credits carry a Pro account on past both
		{"Pro with credits, past its overage", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			credits(m)["overage_limit_reached"] = true
		}), false},
		{"Pro with credits, at a spend cap", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			m["spend_control"].(map[string]any)["reached"] = true
		}), false},
		// only allowed false holds it: limit_reached alone doesn't
		{"limit reached but allowed, no credits", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			delete(m, "credits")
			rateLimit(m)["limit_reached"], rateLimit(m)["allowed"] = true, true
		}), false},
		{"limit reached, allowed not said, no credits", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			delete(m, "credits")
			rateLimit(m)["limit_reached"] = true
			delete(rateLimit(m), "allowed")
		}), false},
		{"not allowed, limit not reached, no credits", with(read("codex_usage_pro_credits.json"), func(m map[string]any) {
			delete(m, "credits")
			rateLimit(m)["limit_reached"], rateLimit(m)["allowed"] = false, false
		}), true},
		{"Business without credits, within its overage", within("business", as), false},
		{"K12 without credits, within its overage", within("k12", as), false},
		{"Law without credits, within its overage", within("law", as), false},
		{"Sci without credits, within its overage", within("sci", as), false},
		{"FinServ without credits, within its overage", within("finserv", as), false},
		{"Enterprise trial without credits, within its overage", within("enterprise_cbp_trial", as), false},
		{"Enterprise view-only without credits, within its overage", within("enterprise_cbp_view_only", as), false},
		{"Pro without credits, its overage open", within("pro", as), true},
		// the app's reserve experiment holds these on no credits, overage
		// or not, and magpie can't see whether it is on
		{"Team without credits, within its overage", within("team", as), true},
		{"Business at its spend cap", within("business", func(m map[string]any) {
			m["spend_control"].(map[string]any)["reached"] = true
		}), true},
		{"Business at its owner's limit", within("business", func(m map[string]any) {
			m["rate_limit_reached_type"].(map[string]any)["type"] = "workspace_owner_usage_limit_reached"
		}), true},
		{"Business past its overage", within("business", func(m map[string]any) {
			credits(m)["overage_limit_reached"] = true
		}), true},
		{"Business, overage not said", within("business", func(m map[string]any) {
			delete(credits(m), "overage_limit_reached")
		}), true},
		{"Team without credits, at its owner's limit", with(read("codex_usage_team_spend_cap.json"), func(m map[string]any) {
			credits(m)["has_credits"] = false
		}), true},
	} {
		t.Run(c.name, func(t *testing.T) {
			b, err := json.Marshal(c.body)
			if err != nil {
				t.Fatal(err)
			}
			var got codexUsage
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatal(err)
			}
			if held := codexHeld(got); held != c.want {
				t.Fatalf("backend held = %v, want %v", held, c.want)
			}
		})
	}
}
