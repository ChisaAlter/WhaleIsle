package gateway

import (
	"net/http"
	"os"

	"github.com/yetone/magpie/internal/omarchy"
	"github.com/yetone/magpie/internal/provider"
)

// siteOrigins are the pages that may read the Omarchy theme: usemagpie.ai,
// which on an Omarchy machine draws itself in that machine's theme
// (site/public/omarchy.js) and asks the magpie running there which one it
// is; MAGPIE_SITE_ORIGIN adds one (the site served locally to try it).
var siteOrigins = map[string]bool{"https://usemagpie.ai": true, "https://www.usemagpie.ai": true}

func siteOrigin(o string) bool {
	return siteOrigins[o] || o != "" && o == os.Getenv("MAGPIE_SITE_ORIGIN")
}

// onOmarchy is whether this magpie runs on Omarchy, asked once.
var onOmarchy = omarchy.Detect()

// omarchyTheme is Omarchy's current theme as magpie's own windows draw it
// (name, mode, stamp, CSS variables: palette, font, corners, border), for
// usemagpie.ai's pages on the same machine. It answers this machine only,
// and the browser lets only usemagpie.ai read it; a magpie elsewhere says
// 404.
func (s *Server) omarchyTheme(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); siteOrigin(o) {
		w.Header().Set("Access-Control-Allow-Origin", o)
		w.Header().Set("Vary", "Origin")
		if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !local(r) {
		writeError(w, provider.Chat, http.StatusForbidden, "magpie tells its Omarchy theme to this machine only")
		return
	}
	th, ok := omarchy.Theme{}, false
	if onOmarchy {
		th, ok = omarchy.Current()
	}
	if !ok {
		writeError(w, provider.Chat, http.StatusNotFound, "magpie isn't running on Omarchy")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, th)
}
