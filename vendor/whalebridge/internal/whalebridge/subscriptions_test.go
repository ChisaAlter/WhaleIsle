package whalebridge

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAdapterInstallReportsFailureInRequestedFormat(t *testing.T) {
	h := newProviderHTTP(t)
	for _, accept := range []string{"application/json", "application/x-ndjson"} {
		req, err := http.NewRequest("POST", h.url+"/api/subscription/adapter", strings.NewReader(`{"action":"install","package":"invalid package"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", accept)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if accept == "application/json" {
			if res.StatusCode != 400 || !strings.Contains(string(body), "isn't an npm package name") {
				t.Fatalf("JSON failure: %d %s", res.StatusCode, body)
			}
			continue
		}
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/x-ndjson" {
			t.Fatalf("stream headers: %d %v", res.StatusCode, res.Header)
		}
		dec := json.NewDecoder(strings.NewReader(string(body)))
		var phase, failure map[string]any
		if err := dec.Decode(&phase); err != nil || phase["phase"] != "downloading" {
			t.Fatalf("download phase: %v %v", phase, err)
		}
		if err := dec.Decode(&failure); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(failure["error"].(string), "isn't an npm package name") {
			t.Fatalf("failure: %v", failure)
		}
		var extra map[string]any
		if err := dec.Decode(&extra); err != io.EOF {
			t.Fatalf("unexpected completion after failure: %v %v", extra, err)
		}
	}
}
