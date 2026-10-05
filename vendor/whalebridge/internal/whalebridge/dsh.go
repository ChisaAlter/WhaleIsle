package whalebridge

import (
	"fmt"

	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"os"

	"slices"
	"sync"
)

const keyName = "WHALEBRIDGE_GATEWAY_KEY"

var dshWrites sync.Mutex

type routeModel struct {
	ID               string            `yaml:"id"`
	Name             string            `yaml:"name"`
	ContextWindow    int               `yaml:"contextWindow,omitempty"`
	MaxTokens        int               `yaml:"maxTokens,omitempty"`
	Input            []string          `yaml:"input,omitempty"`
	ReasoningEfforts map[string]string `yaml:"reasoningEfforts,omitempty"`
}

func syncDSH() error {
	home := os.Getenv("WHALEBRIDGE_DSH_HOME")
	if home == "" {
		return fmt.Errorf("缺少 DSH 数据目录")
	}
	dshWrites.Lock()
	defer dshWrites.Unlock()
	models, _ := provider.CatalogFor("dsh")
	labels := provider.Labels(models)
	out := make([]routeModel, 0, len(models))
	for i, m := range models {
		row := routeModel{ID: m.ID, Name: labels[i], ContextWindow: m.Context, MaxTokens: m.Output}
		if row.ContextWindow > 0 && row.MaxTokens > row.ContextWindow {
			row.MaxTokens = row.ContextWindow
		}
		if m.Images {
			row.Input = []string{"text", "image"}
		} else if m.ImageInput != nil {
			row.Input = []string{"text"}
		}
		levels := map[string]string{}
		for _, level := range []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"} {
			effort := level
			if level == "off" {
				effort = "none"
			}
			if slices.Contains(m.Efforts, effort) {
				levels[level] = effort
			}
		}
		if len(levels) > 1 || len(levels) == 1 && levels["off"] == "" {
			row.ReasoningEfforts = levels
		}
		out = append(out, row)
	}
	route := struct {
		DisplayName string       `yaml:"displayName"`
		APIKeyEnv   string       `yaml:"apiKeyEnv"`
		API         string       `yaml:"api"`
		BaseURL     string       `yaml:"baseURL"`
		Models      []routeModel `yaml:"models"`
	}{"鲸桥", keyName, "openai-completions", gateway.URL() + "/v1", out}
	return updateProfile(home, route, false)
}

func Disconnect(home string) error {
	if home == "" {
		return fmt.Errorf("缺少 DSH 数据目录")
	}
	dshWrites.Lock()
	defer dshWrites.Unlock()
	return updateProfile(home, nil, true)
}
func isDefault() bool { return profileDefault(os.Getenv("WHALEBRIDGE_DSH_HOME")) }
