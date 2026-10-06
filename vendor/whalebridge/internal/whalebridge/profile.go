package whalebridge

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/yetone/magpie/internal/edit"
	"gopkg.in/yaml.v3"
)

func profilePath(home string) string {
	return filepath.Join(home, "profiles", "web", "cordis.patch.yml")
}
func member(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}
func put(n *yaml.Node, key string, value *yaml.Node) {
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			n.Content[i+1] = value
			return
		}
	}
	n.Content = append(n.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, value)
}
func drop(n *yaml.Node, key string) {
	if n == nil || n.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			n.Content = append(n.Content[:i], n.Content[i+2:]...)
			return
		}
	}
}
func mapAt(n *yaml.Node, key string) (*yaml.Node, error) {
	value := member(n, key)
	if value == nil {
		value = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		put(n, key, value)
	}
	if value.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("DSH 配置 %s 必须为映射", key)
	}
	return value, nil
}
func profileDocument(home string) (*yaml.Node, error) {
	return patchDocument(profilePath(home))
}
func patchDocument(path string) (*yaml.Node, error) {
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		data = []byte("[]\n")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) != 1 || doc.Content[0].Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("DSH profile 配置必须为 YAML 列表")
	}
	return &doc, nil
}
func profileDefault(home string) bool {
	info, err := Inspect(home)
	return err == nil && info.DefaultModel
}

type ProfileStatus struct {
	DefaultModel bool `json:"defaultModel"`
}

// Inspect reads both persistent patch layers without starting the component.
func Inspect(home string) (ProfileStatus, error) {
	var info ProfileStatus
	if home == "" {
		return info, fmt.Errorf("缺少 DSH 数据目录")
	}
	var cfg *yaml.Node
	for _, path := range []string{profilePath(home), filepath.Join(home, "cordis.patch.yml")} {
		doc, err := patchDocument(path)
		if err != nil {
			return info, err
		}
		if row := configRow(doc, "agent-default-model"); row != nil {
			cfg = member(row, "config")
		}
	}
	if p := member(cfg, "provider"); p != nil {
		info.DefaultModel = p.Value == "whalebridge"
	}
	return info, nil
}

func patchRows(doc *yaml.Node, id string) []*yaml.Node {
	name := map[string]string{"llm-pi-ai": "@deepseek-ai/dsh-llm-pi-ai", "agent-default-model": "@deepseek-ai/dsh-agent-default-model"}[id]
	var rows []*yaml.Node
	for _, row := range doc.Content[0].Content {
		key := member(row, "id")
		if key == nil || key.Value != id || member(row, "insert") != nil {
			continue
		}
		if n := member(row, "name"); n != nil && n.Value != "" && n.Value != name {
			continue
		}
		rows = append(rows, row)
	}
	return rows
}

func configRow(doc *yaml.Node, id string) *yaml.Node {
	for _, row := range slices.Backward(patchRows(doc, id)) {
		if member(row, "config") != nil {
			return row
		}
	}
	return nil
}

func editRoute(doc *yaml.Node, route any, disconnect, add bool) (changed bool, err error) {
	before, err := yaml.Marshal(doc)
	if err != nil {
		return false, err
	}
	defer func() {
		if err == nil {
			after, encodeErr := yaml.Marshal(doc)
			changed, err = !bytes.Equal(before, after), encodeErr
		}
	}()
	for _, row := range patchRows(doc, "llm-pi-ai") {
		providers := member(member(row, "config"), "providers")
		if owned := member(providers, "whalebridge"); owned != nil {
			key := member(owned, "apiKeyEnv")
			if key == nil || key.Value != keyName {
				return false, fmt.Errorf("已有同名 whalebridge 渠道，未覆盖用户配置")
			}
			drop(providers, "whalebridge")
			changed = true
		}
	}
	if disconnect {
		for _, row := range patchRows(doc, "agent-default-model") {
			cfg := member(row, "config")
			if p := member(cfg, "provider"); p != nil && p.Value == "whalebridge" {
				for _, key := range []string{"provider", "model", "reasoningEffort"} {
					drop(cfg, key)
				}
				if len(cfg.Content) == 0 {
					drop(row, "config")
				}
				changed = true
			}
		}
		return changed, nil
	}
	if !add {
		return changed, nil
	}
	last := configRow(doc, "llm-pi-ai")
	if last == nil {
		rows := patchRows(doc, "llm-pi-ai")
		if len(rows) > 0 {
			last = rows[len(rows)-1]
		} else {
			last = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			put(last, "id", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "llm-pi-ai"})
			doc.Content[0].Content = append(doc.Content[0].Content, last)
		}
	}
	cfg, err := mapAt(last, "config")
	if err != nil {
		return false, err
	}
	providers, err := mapAt(cfg, "providers")
	if err != nil {
		return false, err
	}
	var value yaml.Node
	if err := value.Encode(route); err != nil {
		return false, err
	}
	put(providers, "whalebridge", &value)
	return true, nil
}

func writeDocument(path string, doc *yaml.Node, private bool) error {
	var buf bytes.Buffer
	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)
	if err := encoder.Encode(doc); err != nil {
		return err
	}
	if err := encoder.Close(); err != nil {
		return err
	}
	if private {
		return writePrivateDocument(path, buf.Bytes())
	}
	return edit.WriteAtomic(path, buf.Bytes())
}

// Use the same writer lock as DSH ConfigEditor. A concurrent settings edit
// fails visibly; callers can save again after that edit completes.
func updateProfile(home string, route any, disconnect bool) error {
	release, err := lockDSHFiles(home)
	if err != nil {
		return err
	}
	defer release()
	return updateProfileLocked(home, route, disconnect)
}

func updateProfileLocked(home string, route any, disconnect bool) error {
	doc, err := profileDocument(home)
	if err != nil {
		return err
	}
	homePath := filepath.Join(home, "cordis.patch.yml")
	override, err := patchDocument(homePath)
	if err != nil {
		return err
	}
	if !disconnect {
		var disabled *yaml.Node
		for _, layer := range []*yaml.Node{doc, override} {
			for _, row := range patchRows(layer, "llm-pi-ai") {
				if value := member(row, "disabled"); value != nil {
					disabled = value
				}
			}
		}
		if disabled != nil && disabled.Tag == "!!bool" && disabled.Value == "true" {
			return fmt.Errorf("DSH 的 llm-pi-ai 已禁用，请先在 DSH 启用模型插件")
		}
	}
	changed, err := editRoute(doc, route, disconnect, !disconnect)
	if err != nil {
		return err
	}
	homeChanged, err := editRoute(override, route, disconnect, !disconnect && configRow(override, "llm-pi-ai") != nil)
	if err != nil {
		return err
	}
	credentials := filepath.Join(home, ".credentials.yaml")
	credentialDoc, credentialChanged, err := editGatewayCredential(credentials, disconnect)
	if err != nil {
		return err
	}
	env := filepath.Join(home, ".env")
	return edit.Atomically(func() error {
		if credentialChanged {
			if err := writeDocument(credentials, credentialDoc, true); err != nil {
				return err
			}
		}
		// Migrate only the component's legacy dotenv key; the managed store
		// hot-publishes this reference to an already-running DSH.
		if value, ok := edit.GetEnvFile(env, keyName); ok && value == gatewayCredential() {
			if err := edit.DelEnvFile(env, keyName); err != nil {
				return err
			}
		}
		if homeChanged {
			if err := writeDocument(homePath, override, false); err != nil {
				return err
			}
		}
		if changed {
			return writeDocument(profilePath(home), doc, false)
		}
		return nil
	}, profilePath(home), homePath, credentials, env)
}
