package whalebridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
	"github.com/yetone/magpie/internal/upstream"
)

// supplierInfo keeps credentials out of initial page state. Header values,
// API keys and account-wide balance tokens are edited with explicit patches.
func supplierInfo(p provider.Provider) map[string]any {
	headers := make([]string, 0, len(p.Headers))
	for name := range p.Headers {
		headers = append(headers, name)
	}
	sort.Strings(headers)
	set := settings.Load()
	prefs := map[string]provider.ModelPref{}
	prices := map[string]catalog.Price{}
	for ref, n := range set.ModelNames {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			v := prefs[m]
			v.Name = &n
			prefs[m] = v
		}
	}
	for ref, n := range set.ModelEfforts {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			v := prefs[m]
			v.Efforts = &n
			prefs[m] = v
		}
	}
	for ref, n := range set.ModelImages {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			v := prefs[m]
			v.Images = &n
			prefs[m] = v
		}
	}
	for ref, n := range set.ModelAPIs {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			v := prefs[m]
			v.API = &n
			prefs[m] = v
		}
	}
	for ref, n := range set.ModelSameAs {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			v := prefs[m]
			v.Same = &n
			prefs[m] = v
		}
	}
	for ref, n := range set.ModelPrices {
		if m, ok := strings.CutPrefix(ref, p.ID+"/"); ok {
			if price, bad := n.Price(); bad == "" {
				prices[m] = price
			}
		}
	}
	for model, price := range prices {
		v := prefs[model]
		v.Price = &price
		prefs[model] = v
	}
	available := []map[string]any{}
	seen := map[string]bool{}
	exposed := map[string]bool{}
	for _, m := range p.Exposed() {
		exposed[m.ID] = true
	}
	models := append(p.Available(), p.DecisionModels()...)
	models = append(models, p.Exposed()...)
	for _, m := range models {
		if seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		// Keep catalog field names for the existing model-grouping surface.
		data, _ := json.Marshal(m)
		row := map[string]any{}
		_ = json.Unmarshal(data, &row)
		row["id"], row["name"], row["provider"] = m.ID, m.Name, m.Provider
		row["efforts"], row["free"], row["rate"], row["rateWas"] = provider.EffortsOf(m), m.Free, m.Rate, m.RateWas
		row["context"], row["listed"], row["output"], row["max"] = p.WindowOf(m), provider.ListedWindow(m), p.ReplyLimit(m), m.MaxContext
		ownImages := m.Images || catalog.SeesImages(m.ID)
		if m.ImageInput != nil {
			ownImages = *m.ImageInput
		}
		row["ownImages"], row["images"], row["on"] = ownImages, ownImages, exposed[m.ID]
		if v, ok := set.ModelImages[p.ID+"/"+m.ID]; ok {
			row["images"], row["imagesOverride"], row["imageSet"] = v, v, true
		}
		if api, ok := p.ModelAPI(m.ID); ok {
			row["api"] = api
		}
		row["auto"], row["same"], row["merge"] = p.ListedAPIs(m.ID), set.ModelSameAs[p.ID+"/"+m.ID], provider.MergeName(m.ID)
		if n, ok := set.ModelNames[p.ID+"/"+m.ID]; ok {
			row["default"], row["name"] = m.Name, n
		}
		if n, ok := set.ModelEfforts[p.ID+"/"+m.ID]; ok {
			row["kept"] = n
		}
		if len(provider.EffortsOf(m)) == 0 {
			row["efforts"], row["given"] = provider.Levels, true
		}
		if n, ok := prices[m.ID]; ok {
			row["ownPrice"], row["price"] = n, n
		}
		if n, ok := p.ListPrice(m.ID); ok {
			row["list"] = n
		} else if n, ok := provider.MakerPrice(m.ID); ok {
			row["list"] = n
		}
		available = append(available, row)
	}
	keys := keyInfos(p)
	out := map[string]any{
		"id": p.ID, "name": p.Name, "icon": p.Icon, "preset": p.Preset, "host": p.Host(),
		"chat": p.Chat, "responses": p.Responses, "anthropic": p.Anthropic, "decide": p.Decide, "baseAPI": p.BaseAPI,
		"catalog": p.Catalog, "family": p.Family, "website": p.Website, "keysUrl": p.KeysURL,
		"headerNames": headers, "keySet": p.Key != "", "keyMasked": provider.Mask(p.Key), "keyList": keys,
		"models": p.Models, "chosen": p.Models, "available": available, "modelCount": len(p.Exposed()),
		"modelPrefs": prefs, "modelPrices": prices, "modelNames": p.ModelNames(), "modelEfforts": p.ModelEfforts(),
		"contexts": p.Contexts, "outputs": provider.OutputsOf(p.ID), "compacts": provider.CompactsOf(p.ID),
		"ready": p.Ready(), "off": p.Off, "unlisted": p.Unlisted, "searches": p.Searches, "unredacted": p.Unredacted,
		"routing": p.Routing, "affinity": p.Affinity, "sink": p.Sink, "proxy": p.Proxy, "fallback": p.Fallback,
		"maxConcurrency": p.MaxConcurrency, "pluginConcurrency": p.PluginConcurrency(), "accountConcurrency": p.AccountConcurrency,
		"queueLimit": p.QueueLimit, "queueWait": p.QueueWait, "priceRate": p.PriceRate,
		"cline": p.ClinePinnable(), "pinUpstream": p.PinUpstream, "balanceURL": p.BalanceURL, "balancePath": p.BalancePath,
		"modelsURL": p.ModelsURL, "balanceTokenSet": p.BalanceToken != "", "balanceTokenTakes": provider.TakesBalanceToken(p),
		"account": p.Account != nil, "accountProxies": p.AccountProxies, "accountModels": p.AccountModels, "accountCaps": p.AccountCaps,
		"modelTest": p.ModelTest(), "decideTest": p.AsksDecideModels(), "listError": p.ListError(),
	}
	if p.Account != nil {
		out["accountAgent"], out["accountUser"] = p.Account.Agent, p.Account.User
	}
	optional := p.Account != nil
	if pr := provider.Preset(p.Preset); pr != nil {
		optional = optional || pr.NoKey
		out["sponsored"] = pr.Sponsored
	}
	out["keyOptional"] = optional
	if t, ok := p.Listed(); ok {
		out["fetched"] = t
	}
	if provider.TakesZhipuTeam(p) {
		out["zhipuTeam"] = p.ZhipuTeam
		if p.ZhipuTeam == nil {
			out["zhipuTeam"] = &provider.ZhipuTeam{}
		}
	}
	if site := provider.StepFunSite(p); site != "" {
		out["stepPlan"] = map[string]any{"site": site, "signedIn": provider.StepFunSignedIn(site), "url": provider.StepFunSignInURL(site), "bookmarklet": provider.StepFunBookmarklet()}
	}
	return out
}

func keyInfos(p provider.Provider) []provider.KeyInfo {
	keys := p.KeyList()
	if keys == nil {
		keys = []provider.KeyInfo{}
	}
	for i, k := range keys {
		if k.On {
			if rest, ok := gateway.RestOf(p.RestKey(k)); ok {
				keys[i].Rest = &provider.KeyRest{Why: rest.Why, Status: rest.Status, Until: rest.Until, Key: p.RestKey(k)}
			}
		}
	}
	return keys
}

func readProviderBody(r *http.Request) (map[string]json.RawMessage, error) {
	var in map[string]json.RawMessage
	err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in)
	return in, err
}
func bodyValue[T any](in map[string]json.RawMessage, name string) (T, error) {
	var v T
	if b, ok := in[name]; ok {
		if err := json.Unmarshal(b, &v); err != nil {
			return v, fmt.Errorf("%s: %w", name, err)
		}
	}
	return v, nil
}

// patchProvider preserves every field omitted by the editor. The initial
// DTO carries only header names; a null header value removes that header.
func patchProvider(p provider.Provider, in map[string]json.RawMessage) (provider.Provider, error) {
	allowed := strings.Fields("id name icon iconUrl preset keyName keyProtocol keyWeight keys chat responses anthropic decide baseAPI catalog website keysUrl family models unlisted off contexts fallback routing affinity sink searches pinUpstream unredacted proxy accountProxies accountModels accountCaps accountConcurrency balanceURL balancePath modelsURL zhipuTeam maxConcurrency queueLimit queueWait priceRate")
	patch := map[string]json.RawMessage{}
	for _, k := range allowed {
		if v, ok := in[k]; ok {
			patch[k] = v
		}
	}
	data, _ := json.Marshal(patch)
	if err := json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	for key, dst := range map[string]*int{"queueLimit": &p.QueueLimit, "queueWait": &p.QueueWait} {
		if string(in[key]) == "null" {
			*dst = 0
		}
	}
	if string(in["priceRate"]) == "null" {
		p.PriceRate = 0
	}
	if raw, ok := in["headers"]; ok {
		var headers map[string]*string
		if err := json.Unmarshal(raw, &headers); err != nil {
			return p, err
		}
		p.Headers = cloneHeaders(p.Headers)
		if err := patchHeaders(&p, headers); err != nil {
			return p, err
		}
	}
	if k, err := bodyValue[string](in, "key"); err != nil {
		return p, err
	} else if strings.TrimSpace(k) != "" && k != p.Key {
		p.Key = strings.TrimSpace(k)
		if _, stated := in["keyName"]; !stated {
			p.KeyName = ""
		}
		if _, stated := in["keyProtocol"]; !stated {
			p.KeyProtocol = ""
		}
		if _, stated := in["keyWeight"]; !stated {
			p.KeyWeight = 0
		}
	}
	if b, err := bodyValue[bool](in, "clearKey"); err != nil {
		return p, err
	} else if b {
		p.Key = ""
	}
	if k, err := bodyValue[string](in, "balanceToken"); err != nil {
		return p, err
	} else if strings.TrimSpace(k) != "" {
		p.BalanceToken = strings.TrimSpace(k)
	}
	if b, err := bodyValue[bool](in, "clearBalanceToken"); err != nil {
		return p, err
	} else if b {
		p.BalanceToken = ""
	}
	if p.MaxConcurrency != nil && (*p.MaxConcurrency < 0 || *p.MaxConcurrency > provider.MaxLimit) {
		return p, fmt.Errorf("并发上限必须为 0 到 %d", provider.MaxLimit)
	}
	if err := provider.CheckQueue(p.QueueLimit, p.QueueWait); err != nil {
		return p, err
	}
	if bad := provider.PriceRateOK(p.PriceRate); bad != "" {
		return p, fmt.Errorf("%s", bad)
	}
	return p, nil
}
func cloneHeaders(h map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range h {
		out[k] = v
	}
	return out
}

func draftProvider(in map[string]json.RawMessage) (provider.Provider, error) {
	id, err := bodyValue[string](in, "id")
	if err != nil {
		return provider.Provider{}, err
	}
	var p provider.Provider
	if id != "" {
		saved, err := provider.Find(id)
		if err != nil {
			return p, err
		}
		p = *saved
	} else if preset, err := bodyValue[string](in, "preset"); err != nil {
		return p, err
	} else if preset != "" {
		p, err = provider.FromPreset(preset)
		if err != nil {
			return p, err
		}
	}
	return patchProvider(p, in)
}

func saveProvider(r *http.Request) (string, error) {
	in, err := readProviderBody(r)
	if err != nil {
		return "", err
	}
	return saveProviderBody(r.Context(), in)
}
func saveProviderBody(ctx context.Context, in map[string]json.RawMessage) (string, error) {
	id, err := bodyValue[string](in, "id")
	if err != nil {
		return "", err
	}
	from, err := bodyValue[string](in, "from")
	if err != nil {
		return "", err
	}
	isNew, err := bodyValue[bool](in, "new")
	if err != nil {
		return "", err
	}
	copyOf, err := bodyValue[string](in, "copyOf")
	if err != nil {
		return "", err
	}
	oldID := id
	if from != "" {
		oldID = from
	}
	var p provider.Provider
	var old *provider.Provider
	if !isNew && oldID != "" {
		old, _ = provider.Find(oldID)
		if old != nil {
			p = *old
		}
		if from != "" && old == nil {
			return "", fmt.Errorf("原供应商 %q 已不存在，请刷新后再编辑", from)
		}
	}
	if isNew && copyOf != "" {
		saved, err := provider.Find(copyOf)
		if err != nil {
			return "", err
		}
		p = *saved
		p.ID, p.Account = "", nil
	}
	if p.Name == "" {
		if preset, err := bodyValue[string](in, "preset"); err != nil {
			return "", err
		} else if preset != "" {
			p, err = provider.FromPreset(preset)
			if err != nil {
				return "", err
			}
		}
	}
	p, err = patchProvider(p, in)
	if err != nil {
		return "", err
	}
	prefs, err := bodyValue[map[string]provider.ModelPref](in, "modelPrefs")
	if err != nil {
		return "", err
	}
	outs, err := bodyValue[map[string]int](in, "outputs")
	if err != nil {
		return "", err
	}
	compacts, err := bodyValue[map[string]int](in, "compacts")
	if err != nil {
		return "", err
	}
	prices, err := bodyValue[map[string]*catalog.Price](in, "modelPrices")
	if err != nil {
		return "", err
	}
	// Validate prices before adding, renaming or saving the supplier: an
	// invalid price must leave the supplier and its credentials as they were.
	priceID := p.ID
	if priceID == "" {
		priceID = "provider"
	}
	checkPrice := func(model string, price *catalog.Price) error {
		key := priceID + "/" + model
		if err := settings.CheckModelKey("price", key); err != nil {
			return err
		}
		if price == nil {
			return nil
		}
		if err := settings.CheckModelPrice(key, settings.StatedPrice(*price)); err != nil {
			return err
		}
		if model != "*" && !provider.ServesModel(p, model) {
			return fmt.Errorf("%s has no model %s", priceID, model)
		}
		return nil
	}
	for model, pref := range prefs {
		if pref.Price != nil || pref.OwnPrice {
			price := pref.Price
			if pref.OwnPrice {
				price = nil
			}
			if err := checkPrice(model, price); err != nil {
				return "", err
			}
		}
	}
	for model, price := range prices {
		if err := checkPrice(model, price); err != nil {
			return "", err
		}
	}
	if p.IconURL != "" {
		iconCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		icon, err := provider.FetchIcon(iconCtx, p.IconURL)
		cancel()
		if err != nil {
			return "", err
		}
		p.Icon = icon
	}
	var more []string
	if ks := provider.SplitKeys(p.Key); len(ks) > 1 {
		p.Key, more = ks[0], ks[1:]
	}
	if isNew {
		if copyOf != "" {
			id, err = provider.AddCopy(p, copyOf)
		} else {
			id, err = provider.Add(p)
		}
	} else {
		to := strings.ToLower(strings.TrimSpace(p.ID))
		if from != "" && from != to {
			if to == "" || to != provider.Slug(to) {
				return "", fmt.Errorf("供应商 ID 只能包含小写字母、数字和连字符")
			}
			if existing, _ := provider.Find(to); existing != nil {
				return "", fmt.Errorf("供应商 ID %q 已存在", to)
			}
			p.ID = from
		}
		err = provider.Save(p)
		id = p.ID
		if err == nil && from != "" && from != to {
			err = provider.Rename(from, to)
			id = to
		}
	}
	if err != nil {
		return "", err
	}
	if len(more) > 0 {
		_, _, err = provider.AddKeys(id, more, p.KeyProtocol)
		if err != nil {
			return id, err
		}
	}
	if len(prefs) > 0 {
		if err := provider.SetModelPrefs(id, prefs); err != nil {
			return id, err
		}
	}
	if outs != nil {
		if err := provider.SetModelOutputs(id, outs); err != nil {
			return id, err
		}
	}
	if compacts != nil {
		if err := provider.SetModelCompacts(id, compacts); err != nil {
			return id, err
		}
	}
	for model, price := range prices {
		if err := provider.SetModelPrice(id+"/"+model, price); err != nil {
			return id, err
		}
	}
	provider.ForgetBalances()
	if saved, err := provider.Find(id); err == nil && saved.Ready() && (old == nil || old.Key != saved.Key) {
		fetchCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		saved.Fetch(fetchCtx)
		cancel()
	}
	return id, nil
}

func providerRoutes(mux *http.ServeMux, server *gateway.Server) {
	mux.HandleFunc("GET /api/lanes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, server.Lanes()) })
	mux.HandleFunc("POST /api/gateway/unrest", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Key string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if b.Key == "" {
			http.Error(w, "缺少需恢复的密钥或账号", 400)
			return
		}
		writeJSON(w, map[string]bool{"lifted": server.Unrest(b.Key)})
	})
	mux.HandleFunc("GET /api/upstream", func(w http.ResponseWriter, r *http.Request) {
		of := map[string]string{}
		ids := []string{}
		for _, p := range provider.All() {
			if vendor := upstream.VendorOf(p.Chat, p.Responses, p.Anthropic); vendor != "" {
				of[p.ID] = vendor
				if !slices.Contains(ids, vendor) {
					ids = append(ids, vendor)
				}
			}
		}
		writeJSON(w, map[string]any{"vendors": upstream.Wait(4*time.Second, ids...), "providers": of})
	})
	mux.HandleFunc("GET /api/provider/{id}/key", func(w http.ResponseWriter, r *http.Request) {
		p, err := provider.Find(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]string{"key": p.Key})
	})
	mux.HandleFunc("POST /api/provider/{action}", func(w http.ResponseWriter, r *http.Request) {
		in, err := readProviderBody(r)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		action := r.PathValue("action")
		id, err := bodyValue[string](in, "id")
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		fail := func(err error) { http.Error(w, err.Error(), 400) }
		switch action {
		case "test", "detect", "list", "balance":
			p, err := draftProvider(in)
			if err != nil {
				fail(err)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
			defer cancel()
			switch action {
			case "test":
				models, err := bodyValue[[]string](in, "test")
				if err != nil {
					fail(err)
					return
				}
				if len(models) > 0 {
					writeJSON(w, map[string]any{"results": p.TestModels(ctx, models)})
				} else {
					writeJSON(w, map[string]any{"results": p.Test(ctx), "provider": supplierInfo(p)})
				}
			case "detect":
				base, err := bodyValue[string](in, "base")
				if err != nil {
					fail(err)
					return
				}
				model, err := bodyValue[string](in, "model")
				if err != nil {
					fail(err)
					return
				}
				models, err := bodyValue[[]string](in, "detectModels")
				if err != nil {
					fail(err)
					return
				}
				if p.Decide != "" {
					writeJSON(w, map[string]any{"results": []provider.Detection{p.DetectDecide(ctx, model)}})
					return
				}
				if len(models) > 0 {
					each, sum, err := p.DetectModels(ctx, base, models)
					if err != nil {
						fail(err)
						return
					}
					writeJSON(w, map[string]any{"results": sum, "models": each})
					return
				}
				got, err := p.Detect(ctx, base, model)
				if err != nil {
					fail(err)
					return
				}
				writeJSON(w, map[string]any{"results": got})
			case "list":
				ms, err := p.List(ctx)
				if err != nil {
					fail(err)
					return
				}
				rows := []map[string]any{}
				for _, m := range ms {
					data, _ := json.Marshal(m)
					row := map[string]any{}
					_ = json.Unmarshal(data, &row)
					row["id"], row["name"] = m.ID, m.Name
					rows = append(rows, row)
				}
				writeJSON(w, map[string]any{"models": rows})
			case "balance":
				amount, ok, err := provider.Balance(ctx, p)
				out := map[string]any{"ok": ok, "amount": amount}
				if err != nil {
					out["error"] = err.Error()
				}
				writeJSON(w, out)
			}
			return
		case "export":
			p, err := provider.Find(id)
			if err != nil {
				fail(err)
				return
			}
			q := url.Values{"id": {p.ID}, "name": {p.Name}, "chat": {p.Chat}, "responses": {p.Responses}, "anthropic": {p.Anthropic}, "catalog": {p.Catalog}, "website": {p.Website}, "keys": {p.KeysURL}, "models": {strings.Join(p.Models, ",")}}
			clean := *p
			clean.Key, clean.BalanceToken, clean.Keys, clean.Headers, clean.Account = "", "", nil, nil, nil
			data, _ := json.Marshal(clean)
			exported := map[string]any{}
			_ = json.Unmarshal(data, &exported)
			info := supplierInfo(*p)
			for _, field := range []string{"modelPrefs", "modelPrices", "outputs", "compacts"} {
				exported[field] = info[field]
			}
			text, _ := json.MarshalIndent(exported, "", "  ")
			writeJSON(w, map[string]any{"link": "magpie://import?" + q.Encode(), "provider": exported, "text": string(text)})
			return
		case "icon":
			address, err := bodyValue[string](in, "url")
			if err != nil {
				fail(err)
				return
			}
			name, err := bodyValue[string](in, "name")
			if err != nil {
				fail(err)
				return
			}
			icon, err := provider.FaviconFor(r.Context(), address, name)
			if err != nil {
				fail(err)
				return
			}
			writeJSON(w, map[string]string{"icon": icon})
			return
		case "import":
			text, err := bodyValue[string](in, "text")
			if err != nil {
				fail(err)
				return
			}
			if text != "" {
				rows, err := importProviderBodies(text)
				if err != nil {
					fail(err)
					return
				}
				key, err := bodyValue[string](in, "key")
				if err != nil {
					fail(err)
					return
				}
				if strings.TrimSpace(key) != "" {
					if len(rows) != 1 {
						fail(fmt.Errorf("多个供应商请分别在配置 JSON 中填写密钥"))
						return
					}
					rawKey, _ := json.Marshal(key)
					rows[0]["key"] = rawKey
				}
				preview, err := bodyValue[bool](in, "preview")
				if err != nil {
					fail(err)
					return
				}
				if preview {
					summaries := []map[string]any{}
					for _, row := range rows {
						var p provider.Provider
						preset, err := bodyValue[string](row, "preset")
						if err != nil {
							fail(err)
							return
						}
						if preset != "" {
							p, err = provider.FromPreset(preset)
							if err != nil {
								fail(err)
								return
							}
						}
						p, err = patchProvider(p, row)
						if err != nil {
							fail(err)
							return
						}
						summaries = append(summaries, supplierInfo(p))
					}
					writeJSON(w, map[string]any{"providers": summaries})
					return
				}
				mutations.Lock()
				defer mutations.Unlock()
				added := []string{}
				for _, row := range rows {
					row["new"] = json.RawMessage("true")
					delete(row, "from")
					imported, err := saveProviderBody(r.Context(), row)
					if err != nil {
						http.Error(w, fmt.Sprintf("已添加 %d 个供应商；导入失败: %v", len(added), err), 400)
						return
					}
					added = append(added, imported)
				}
				if err := syncDSH(); err != nil {
					http.Error(w, "供应商已导入，但 DSH 渠道同步失败: "+err.Error(), 500)
					return
				}
				writeJSON(w, map[string]any{"ok": true, "added": added})
				return
			}
			link, err := bodyValue[string](in, "link")
			if err != nil {
				fail(err)
				return
			}
			if link == "" {
				link, err = bodyValue[string](in, "url")
				if err != nil {
					fail(err)
					return
				}
			}
			p, err := provider.ParseImport(link)
			if err != nil {
				fail(err)
				return
			}
			writeJSON(w, map[string]any{"provider": p})
			return
		}
		// All configuration mutations serialize with account changes and DSH sync.
		mutations.Lock()
		defer mutations.Unlock()
		out := map[string]any{"ok": true}
		switch action {
		case "show":
			err = provider.ShowAccount(id)
		case "quiet":
			err = provider.QuietAccount(id)
		case "tuck", "untuck":
			err = provider.TuckAccount(id, action == "tuck")
		case "forget":
			err = provider.ForgetAccount(id)
		case "save":
			out["id"], err = saveProviderBody(r.Context(), in)
		case "order":
			var order []string
			order, err = bodyValue[[]string](in, "order")
			if err == nil && order == nil {
				order, err = bodyValue[[]string](in, "ids")
			}
			if err == nil {
				err = provider.SetOrder(order)
			}
		case "models":
			var p provider.Provider
			p, err = draftProvider(in)
			if err == nil {
				ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
				ms, dropped, e := p.Refetch(ctx)
				cancel()
				err = e
				if e == nil {
					saved, e := provider.Find(id)
					if e != nil {
						err = e
					} else {
						out["count"], out["dropped"], out["provider"] = len(ms), dropped, supplierInfo(*saved)
					}
				}
			}
		case "unfetch":
			err = catalog.SaveLive(id, "", nil)
		case "on", "off":
			err = provider.SetOff(id, action == "off")
			provider.ForgetBalances()
		case "route":
			var v string
			v, err = bodyValue[string](in, "routing")
			if err == nil {
				err = provider.SetRouting(id, v)
			}
		case "affinity":
			var v string
			v, err = bodyValue[string](in, "affinity")
			if err == nil {
				err = provider.SetAffinity(id, v)
			}
		case "sink":
			var v bool
			v, err = bodyValue[bool](in, "sink")
			if err == nil {
				err = provider.SetSink(id, v)
			}
		case "arrange":
			var order []string
			order, err = bodyValue[[]string](in, "accountOrder")
			if err == nil {
				err = provider.WhaleBridgeSetAccountOrder(id, order)
			}
		case "accountmodels":
			var ref string
			ref, err = bodyValue[string](in, "account")
			if err == nil {
				var allow []string
				allow, err = bodyValue[[]string](in, "allow")
				if err == nil {
					err = provider.SetAccountModels(id, ref, allow)
				}
			}
		case "accountcap":
			var ref string
			ref, err = bodyValue[string](in, "account")
			if err == nil {
				var cap int
				cap, err = bodyValue[int](in, "cap")
				if err == nil {
					err = provider.SetAccountCap(id, ref, cap)
				}
			}
		case "accountconcurrency":
			var ref string
			ref, err = bodyValue[string](in, "account")
			if err == nil {
				var limit *int
				limit, err = bodyValue[*int](in, "limit")
				if err == nil {
					err = provider.SetAccountConcurrency(id, ref, limit)
				}
			}
		case "prefs", "name", "efforts", "images", "api", "same", "price", "reset":
			model, e := bodyValue[string](in, "model")
			err = e
			if err != nil {
				break
			}
			ref := id + "/" + model
			switch action {
			case "prefs":
				var prefs map[string]provider.ModelPref
				prefs, err = bodyValue[map[string]provider.ModelPref](in, "modelPrefs")
				if err == nil {
					err = provider.SetModelPrefs(id, prefs)
				}
			case "name":
				var name string
				name, err = bodyValue[string](in, "modelName")
				if err == nil {
					err = provider.SetModelName(ref, name)
				}
			case "efforts":
				var efforts []string
				efforts, err = bodyValue[[]string](in, "efforts")
				if err == nil {
					err = provider.SetModelEfforts(ref, efforts)
				}
			case "images":
				var images *bool
				images, err = bodyValue[*bool](in, "images")
				if err == nil {
					err = provider.SetModelImage(ref, images)
				}
			case "api":
				var api string
				api, err = bodyValue[string](in, "api")
				if err == nil {
					err = provider.SetModelAPI(ref, api)
				}
			case "same":
				var same string
				same, err = bodyValue[string](in, "same")
				if err == nil {
					err = provider.SetModelSame(ref, same)
				}
			case "price":
				var price *catalog.Price
				price, err = bodyValue[*catalog.Price](in, "price")
				if err == nil {
					err = provider.SetModelPrice(ref, price)
				}
			case "reset":
				name, api, same := "", "", ""
				levels := []string{}
				err = provider.SetModelPrefs(id, map[string]provider.ModelPref{model: {Name: &name, Efforts: &levels, OwnImages: true, API: &api, Same: &same}})
				if err == nil {
					err = provider.SetModelPrice(ref, nil)
				}
				if err == nil {
					_, _, err = provider.DropModelOutput(ref)
				}
				if err == nil {
					compacts := provider.CompactsOf(id)
					delete(compacts, model)
					err = provider.SetModelCompacts(id, compacts)
				}
				if err == nil {
					p, e := provider.Find(id)
					if e != nil {
						err = e
					} else {
						_, err = provider.DropContext(*p, model)
					}
				}
			}
		default:
			http.NotFound(w, r)
			return
		}
		if err != nil {
			fail(err)
			return
		}
		if err := syncDSH(); err != nil {
			http.Error(w, "配置已保存，但 DSH 渠道同步失败: "+err.Error(), 500)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/icons", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Data string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*provider.MaxIcon)).Decode(&b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		data, err := base64.StdEncoding.DecodeString(b.Data)
		if err == nil {
			var icon string
			icon, err = provider.StoreIcon(data)
			if err == nil {
				writeJSON(w, map[string]string{"icon": icon})
				return
			}
		}
		http.Error(w, err.Error(), 400)
	})
	mux.HandleFunc("POST /api/icons/favicon", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ URL, Name string }
		if err := decode(w, r, &b); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		icon, err := provider.FaviconFor(r.Context(), b.URL, b.Name)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		writeJSON(w, map[string]string{"icon": icon})
	})
	mux.HandleFunc("GET /api/icons/{name}", func(w http.ResponseWriter, r *http.Request) {
		path := provider.IconFile(r.PathValue("name"))
		if path == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		http.ServeFile(w, r, path)
	})
}

func importProviderBodies(text string) ([]map[string]json.RawMessage, error) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "magpie:") {
		p, err := provider.ParseImport(text)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(p)
		row := map[string]json.RawMessage{}
		_ = json.Unmarshal(data, &row)
		return []map[string]json.RawMessage{row}, nil
	}
	var rows []map[string]json.RawMessage
	if strings.HasPrefix(text, "[") {
		if err := json.Unmarshal([]byte(text), &rows); err != nil {
			return nil, err
		}
	} else {
		var row map[string]json.RawMessage
		if err := json.Unmarshal([]byte(text), &row); err != nil {
			return nil, err
		}
		if ps, ok := row["providers"]; ok {
			if err := json.Unmarshal(ps, &rows); err != nil {
				return nil, err
			}
		} else if p, ok := row["provider"]; ok {
			var inner map[string]json.RawMessage
			if err := json.Unmarshal(p, &inner); err != nil {
				return nil, err
			}
			rows = []map[string]json.RawMessage{inner}
		} else {
			rows = []map[string]json.RawMessage{row}
		}
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("没有可导入的供应商")
	}
	return rows, nil
}
