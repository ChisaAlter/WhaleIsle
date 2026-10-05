package gateway

// ModelScope's API-Inference draws on an images API of its own: a POST to
// /images/generations with X-ModelScope-Async-Mode starts a task and
// answers its task_id, which GET /tasks/<id> (X-ModelScope-Task-Type:
// image_generation) reports on until task_status is SUCCEED, with
// output_images, or FAILED. It takes one task of a user's at a time
// ("user queue is full" otherwise) and limits bursts with 429s, so magpie
// asks it one image at a time, and again after a short wait when it is busy.
// Its answers carry no OpenAI "data", which read as an empty drawing (#645).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// isModelScope is a provider at ModelScope's API-Inference, a preset's or
// one added by hand.
var isModelScope = func(p provider.Provider) bool {
	return provider.HostOf(p.Base(provider.Chat)) == "api-inference.modelscope.cn"
}

var (
	// modelScopePoll is how often a task is asked after
	modelScopePoll = 2 * time.Second
	// modelScopeBusy are the waits before asking again when busy
	modelScopeBusy = []time.Duration{3 * time.Second, 8 * time.Second, 15 * time.Second}
	// modelScopeQueues hold one task at a time per key
	modelScopeQueues sync.Map
)

func (s *Server) drawModelScope(ctx context.Context, p provider.Provider, model string, d drawing) (drawn, int, error) {
	base := strings.TrimRight(p.Base(provider.Chat), "/")
	req := map[string]any{"model": model, "prompt": d.Prompt}
	if d.Size != "" && d.Size != "auto" {
		req["size"] = d.Size
	}
	if len(d.Images) > 0 { // its edit models take the images by URL
		var urls []string
		for _, pic := range d.Images {
			urls = append(urls, pic.dataURL())
		}
		req["image_url"] = urls
	}
	body, _ := json.Marshal(req)
	q, _ := modelScopeQueues.LoadOrStore(p.ID+"\x00"+p.Key, &sync.Mutex{})
	mu := q.(*sync.Mutex)
	var out drawn
	for range max(d.N, 1) {
		mu.Lock()
		pics, code, err := s.modelScopeTask(ctx, p, base, body)
		mu.Unlock()
		if err != nil {
			if len(out.Images) > 0 { // some drawn is an answer
				break
			}
			return out, code, err
		}
		out.Images = append(out.Images, pics...)
	}
	return out, 200, nil
}

// modelScopeTask draws one image: starts the task, then asks after it.
func (s *Server) modelScopeTask(ctx context.Context, p provider.Provider, base string, body []byte) ([]picture, int, error) {
	async := http.Header{"X-Modelscope-Async-Mode": {"true"}}
	var b []byte
	var code int
	var err error
	for i := 0; ; i++ {
		b, code, err = s.sendWith(ctx, p, http.MethodPost, base+"/images/generations", "application/json", body, true, async)
		busy := code == 429 || err != nil && strings.Contains(err.Error(), "queue is full")
		if !busy || i >= len(modelScopeBusy) {
			break
		}
		select {
		case <-ctx.Done():
			return nil, 504, fmt.Errorf("%s didn't answer in %s", p.Name, drawTimeout)
		case <-time.After(modelScopeBusy[i]):
		}
	}
	if err != nil {
		return nil, code, err
	}
	var started struct {
		TaskID string `json:"task_id"`
		modelScopeResult
	}
	if err := json.Unmarshal(b, &started); err != nil {
		return nil, 502, fmt.Errorf("%s's answer isn't ModelScope's images API's: %v", p.Name, err)
	}
	if pics := started.pictures(); len(pics) > 0 || started.TaskID == "" {
		// a sync answer, or none to wait for
		if len(pics) == 0 {
			return nil, 502, fmt.Errorf("%s started no image task%s", p.Name, vendorSaid(vendorMessage(b)))
		}
		return pics, code, nil
	}
	task := http.Header{"X-Modelscope-Task-Type": {"image_generation"}}
	for {
		select {
		case <-ctx.Done():
			return nil, 504, fmt.Errorf("%s didn't finish drawing in %s", p.Name, drawTimeout)
		case <-time.After(modelScopePoll):
		}
		b, code, err := s.sendWith(ctx, p, http.MethodGet, base+"/tasks/"+started.TaskID, "", nil, true, task)
		if err != nil {
			return nil, code, err
		}
		var st struct {
			Status string `json:"task_status"`
			modelScopeResult
		}
		if err := json.Unmarshal(b, &st); err != nil {
			return nil, 502, fmt.Errorf("%s's task answer isn't ModelScope's: %v", p.Name, err)
		}
		switch strings.ToUpper(st.Status) {
		case "SUCCEED", "SUCCEEDED", "SUCCESS":
			if pics := st.pictures(); len(pics) > 0 {
				return pics, 200, nil
			}
			return nil, 502, fmt.Errorf("%s finished the task with no image%s", p.Name, vendorSaid(vendorMessage(b)))
		case "FAILED", "FAILURE", "CANCELED", "CANCELLED":
			return nil, 502, fmt.Errorf("%s's image task failed%s", p.Name, vendorSaid(vendorMessage(b)))
		}
	}
}

// modelScopeResult is where ModelScope puts its images: output_images on a
// task, images on a sync answer.
type modelScopeResult struct {
	Output []string `json:"output_images"`
	Images []struct {
		URL string `json:"url"`
	} `json:"images"`
}

func (r modelScopeResult) pictures() []picture {
	var out []picture
	for _, u := range r.Output {
		if u != "" {
			out = append(out, picture{URL: u})
		}
	}
	for _, im := range r.Images {
		if im.URL != "" {
			out = append(out, picture{URL: im.URL})
		}
	}
	return out
}
