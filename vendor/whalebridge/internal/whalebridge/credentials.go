package whalebridge

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/steady"
	"gopkg.in/yaml.v3"
)

func gatewayCredential() string {
	if token := os.Getenv("WHALEBRIDGE_GATEWAY_TOKEN"); token != "" {
		return token
	}
	data, _ := os.ReadFile(filepath.Join(appdir.Config(), "gateway.key"))
	return strings.TrimSpace(string(data))
}

func editGatewayCredential(path string, disconnect bool) (*yaml.Node, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, false, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		data = []byte("{}\n")
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, false, fmt.Errorf("DSH 受管凭据文件无效，未修改其内容")
	}
	root := doc.Content[0]
	if len(root.Content) != 0 {
		version := member(root, "version")
		if version == nil || version.Tag != "!!int" || version.Value != "1" {
			return nil, false, fmt.Errorf("DSH 凭据格式不是 version: 1，请先通过 DSH 迁移凭据文件")
		}
		for i := 0; i+1 < len(root.Content); i += 2 {
			if key := root.Content[i].Value; key != "version" && key != "refs" && key != "records" {
				return nil, false, fmt.Errorf("DSH 受管凭据含未知字段，未修改其内容")
			}
		}
	}
	refs := member(root, "refs")
	if refs != nil {
		if refs.Kind != yaml.MappingNode {
			return nil, false, fmt.Errorf("DSH 凭据 refs 必须为映射")
		}
		refName := regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
		for i := 0; i+1 < len(refs.Content); i += 2 {
			if !refName.MatchString(refs.Content[i].Value) || refs.Content[i+1].Tag != "!!str" || refs.Content[i+1].Value == "" {
				return nil, false, fmt.Errorf("DSH 凭据 refs 无效，未修改其内容")
			}
		}
	}
	token := gatewayCredential()
	current := member(refs, keyName)
	if current != nil && current.Value != token {
		return nil, false, fmt.Errorf("DSH 已有不同的鲸桥凭据，未覆盖用户配置")
	}
	if disconnect {
		if current == nil {
			return &doc, false, nil
		}
		drop(refs, keyName)
		return &doc, true, nil
	}
	if token == "" {
		return nil, false, fmt.Errorf("缺少鲸桥网关凭据")
	}
	if current != nil {
		return &doc, false, nil
	}
	put(root, "version", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: "1"})
	refs, err = mapAt(root, "refs")
	if err != nil {
		return nil, false, err
	}
	put(refs, keyName, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: token})
	return &doc, true, nil
}

func writePrivateDocument(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".whalebridge-credentials-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return steady.Rename(f.Name(), path)
}
