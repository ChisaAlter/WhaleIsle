package provider

import "github.com/yetone/magpie/internal/plugin"

// Subscription choices are provider/authentication backends, not client
// configuration adapters. Their credentials are still served to DSH.
type WhaleBridgeSubscription struct {
	ID       string          `json:"id"`
	PID      string          `json:"pid,omitempty"`
	Name     string          `json:"name"`
	Plugin   bool            `json:"plugin"`
	Checkin  bool            `json:"checkin,omitempty"`
	Methods  []plugin.Method `json:"methods,omitempty"`
	Package  string          `json:"package,omitempty"`
	RiskNote string          `json:"riskNote,omitempty"`
}

func WhaleBridgeSubscriptions() []WhaleBridgeSubscription {
	out := []WhaleBridgeSubscription{}
	for _, id := range builtinOrder {
		if Moved(id) {
			continue
		}
		out = append(out, WhaleBridgeSubscription{ID: id, Name: nameOf(id), Package: MovePackage(id), RiskNote: subscriptionRisk(id)})
	}
	for _, p := range plugin.Cached() {
		out = append(out, WhaleBridgeSubscription{ID: PluginID(p.ID), PID: p.ID, Name: p.Name, Plugin: true, Methods: p.Methods, Checkin: p.Checkin, RiskNote: subscriptionRisk(p.ID)})
	}
	return out
}

func subscriptionRisk(id string) string {
	switch id {
	case "claude":
		return "Claude 通过 Claude Code 发送请求。Anthropic 可能对其应用之外使用的账号采取限制或封禁；请在授权前了解这一风险。"
	case CommandCodePlanID:
		return "Go 套餐通过 Command Code 私有接口使用，供应商可能视作违反条款并限制账号。Pro、Max 等套餐使用 Provider API。"
	case "qoder", QoderCNID:
		return "Qoder 未提供此用途的公开 API；鲸桥按其桌面客户端方式签名请求，供应商可能将其视为第三方使用并限制账号。"
	case "zed":
		return "Zed 为其编辑器提供这些模型；鲸桥按编辑器方式签名请求，供应商可能限制第三方使用的账号。"
	case "factory":
		return "Factory 为 Droid CLI 提供这些模型；鲸桥按 Droid 方式签名请求，供应商可能限制第三方使用的账号。"
	case MiMoID:
		return "这些模型面向小米 MiMo 应用；鲸桥按应用方式发送请求，供应商可能限制第三方使用的账号。"
	case "antigravity":
		return "Google 可能限制或封禁在 Antigravity 之外使用的 Antigravity 账号，请在授权前了解这一风险。"
	}
	return ""
}
