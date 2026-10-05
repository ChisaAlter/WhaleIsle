package gateway

import (
	"net/http"

	"github.com/yetone/magpie/internal/redact"
	"github.com/yetone/magpie/internal/settings"
)

// redacted masks a request's secrets, as the settings say, before it goes
// to a vendor, and wraps w so what the vendor answers has them back; done
// writes what the wrapper still holds. Nothing masked, nothing wrapped.
func redacted(w http.ResponseWriter, body []byte) (http.ResponseWriter, []byte, func()) {
	o := redactionOptions()
	if !o.Secrets && !o.Personal && len(o.Words) == 0 {
		return w, body, func() {}
	}
	masked, n := redact.MaskJSON(body, o)
	if n == 0 {
		return w, body, func() {}
	}
	rw := redact.NewWriter(w)
	return rw, masked, rw.Finish
}

// redactedPrompt masks a parsed image or video prompt before any vendor
// body is built, including multipart forms, and restores the reply's text.
func redactedPrompt(w http.ResponseWriter, prompt string) (http.ResponseWriter, string, func()) {
	masked, n := redact.Mask(prompt, redactionOptions())
	if n == 0 {
		return w, prompt, func() {}
	}
	rw := redact.NewWriter(w)
	return rw, masked, rw.Finish
}

func redactionOptions() redact.Options {
	st := settings.Load()
	return redact.Options{Secrets: st.Redact, Personal: st.RedactPersonal, Words: st.RedactWords, Rules: st.RedactRules}
}
