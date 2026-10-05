package whalebridge

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"

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
	data, err := os.ReadFile(profilePath(home))
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
	doc, err := profileDocument(home)
	if err != nil {
		return false
	}
	selected := ""
	for _, row := range doc.Content[0].Content {
		if id := member(row, "id"); id != nil && id.Value == "agent-default-model" && member(row, "insert") == nil {
			if p := member(member(row, "config"), "provider"); p != nil {
				selected = p.Value
			}
		}
	}
	return selected == "whalebridge"
}

// Use the same writer lock as DSH ConfigEditor. A concurrent settings edit
// fails visibly; callers can save again after that edit completes.
func updateProfile(home string, route any, disconnect bool) error {
	dir := filepath.Dir(profilePath(home))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	lockPath := filepath.Join(dir, "package.json.lock")
	lock, err := os.OpenFile(lockPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("DSH 配置正在编辑或锁不可用: %w", err)
	}
	defer os.Remove(lockPath)
	if _, err = fmt.Fprintf(lock, "%d\n", os.Getpid()); err != nil {
		lock.Close()
		return err
	}
	if err = lock.Close(); err != nil {
		return err
	}
	doc, err := profileDocument(home)
	if err != nil {
		return err
	}
	var last *yaml.Node
	changed := false
	for _, row := range doc.Content[0].Content {
		id := member(row, "id")
		if id == nil || member(row, "insert") != nil {
			continue
		}
		cfg := member(row, "config")
		if id.Value == "llm-pi-ai" {
			last = row
			providers := member(cfg, "providers")
			owned := member(providers, "whalebridge")
			if owned != nil {
				key := member(owned, "apiKeyEnv")
				if key == nil || key.Value != keyName {
					return fmt.Errorf("已有同名 whalebridge 渠道，未覆盖用户配置")
				}
				drop(providers, "whalebridge")
				changed = true
			}
		}
		if disconnect && id.Value == "agent-default-model" {
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
	}
	if !disconnect {
		if last == nil {
			last = &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			put(last, "id", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "llm-pi-ai"})
			doc.Content[0].Content = append(doc.Content[0].Content, last)
		}
		cfg, err := mapAt(last, "config")
		if err != nil {
			return err
		}
		providers, err := mapAt(cfg, "providers")
		if err != nil {
			return err
		}
		var value yaml.Node
		if err := value.Encode(route); err != nil {
			return err
		}
		put(providers, "whalebridge", &value)
		changed = true
	}
	env := filepath.Join(home, ".env")
	return edit.Atomically(func() error {
		if disconnect {
			if err := edit.DelEnvFile(env, keyName); err != nil {
				return err
			}
		} else {
			if err := edit.SetEnvFile(env, edit.KV{Path: keyName, Value: os.Getenv("WHALEBRIDGE_GATEWAY_TOKEN")}); err != nil {
				return err
			}
		}
		if !changed {
			return nil
		}
		var buf bytes.Buffer
		encoder := yaml.NewEncoder(&buf)
		encoder.SetIndent(2)
		if err := encoder.Encode(doc); err != nil {
			return err
		}
		if err := encoder.Close(); err != nil {
			return err
		}
		return edit.WriteAtomic(profilePath(home), buf.Bytes())
	}, profilePath(home), env)
}
