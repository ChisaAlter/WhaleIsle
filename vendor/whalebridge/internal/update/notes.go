package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
)

// Note is one release's notes, as the app shows them after an update.
type Note struct {
	Version string `json:"version"` // no v
	Notes   string `json:"notes"`   // markdown, its Install section taken out
	URL     string `json:"url,omitempty"`
}

// NotesFeed is where the notes of past releases are listed: beside the
// update feed, on magpie's site. MAGPIE_NOTES_FEED points it elsewhere.
func NotesFeed() string {
	if f := os.Getenv("MAGPIE_NOTES_FEED"); f != "" {
		return f
	}
	return Site + "/api/notes"
}

// ReleasePage is version's page on GitHub, where its notes are when the
// site can't give them (#661).
func ReleasePage(version string) string {
	return "https://github.com/yetone/magpie-releases/releases/tag/v" + strings.TrimPrefix(strings.TrimSpace(version), "v")
}

// NotesBetween asks the site for the notes of every release after after
// (none when "") up to and including upto, newest first, in lang (see
// InLang).
func NotesBetween(ctx context.Context, after, upto, lang string) ([]Note, error) {
	q := url.Values{"upto": {upto}}
	if after != "" {
		q.Set("after", after)
	}
	if lang != "" {
		q.Set("lang", lang)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", NotesFeed()+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("release notes: %s", res.Status)
	}
	var out struct {
		Releases []Note `json:"releases"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("release notes: %w", err)
	}
	for i := range out.Releases {
		out.Releases[i].Notes = InLang(out.Releases[i].Notes, lang)
	}
	return Between(out.Releases, after, upto), nil
}

// zhMarker is where a release's notes turn from English to Chinese: the
// release workflow translates them and puts the Chinese below it.
const zhMarker = "<!-- lang:zh -->"

// InLang is a release's notes in lang, as the site cuts them (a site from
// before it did, or a feed elsewhere, hands them whole): "zh" the Chinese
// where there is some, else the English, everything above the marker.
// Notes from before the marker are English alone, in any language.
func InLang(md, lang string) string {
	i := strings.Index(md, zhMarker)
	if i < 0 {
		return md
	}
	if lang == "zh" {
		if zh := strings.TrimSpace(md[i+len(zhMarker):]); zh != "" {
			return zh
		}
	}
	return strings.TrimSpace(md[:i])
}

// withLang adds lang to a feed's address, as ?lang= (or &lang=).
func withLang(feed, lang string) string {
	if lang == "" {
		return feed
	}
	u, err := url.Parse(feed)
	if err != nil {
		return feed
	}
	q := u.Query()
	q.Set("lang", lang)
	u.RawQuery = q.Encode()
	return u.String()
}

// MaxNotes is how many releases' notes are shown at most: magpie releases
// often, and a long-unopened one would have pages of them.
const MaxNotes = 40

// Between keeps the notes of the releases after after up to and including
// upto, newest first, at most MaxNotes; with after "" only upto's. Each
// one's Install section is taken out, and one left empty is dropped.
func Between(notes []Note, after, upto string) []Note {
	var out []Note
	seen := map[string]bool{}
	for _, n := range notes {
		v := strings.TrimPrefix(strings.TrimSpace(n.Version), "v")
		if parse(v) == nil || seen[v] || Newer(v, upto) {
			continue
		}
		if after == "" {
			if Newer(upto, v) {
				continue
			}
		} else if !Newer(v, after) {
			continue
		}
		n.Version, n.Notes = v, StripInstall(n.Notes)
		if strings.TrimSpace(n.Notes) == "" {
			continue
		}
		seen[v] = true
		out = append(out, n)
	}
	sort.SliceStable(out, func(i, j int) bool { return Newer(out[i].Version, out[j].Version) })
	if len(out) > MaxNotes {
		out = out[:MaxNotes]
	}
	return out
}

var heading = regexp.MustCompile(`^(#{1,6})\s+(.*?)\s*#*\s*$`)

// installHeadings are the Install section's heading in each language the
// notes come in: the Chinese notes call it 安装, and every release's own
// section would otherwise repeat in What's new.
var installHeadings = []string{"Install", "安装", "安裝", "インストール"}

// StripInstall takes a release's "Install" section (in any language) out of
// its notes: the download links, which mean nothing to a magpie that just
// updated itself.
// The section runs to the next heading of its level or above.
func StripInstall(md string) string {
	var out []string
	skip := 0 // the level of the Install heading being skipped, 0 when not
	for _, line := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		if m := heading.FindStringSubmatch(line); m != nil {
			level := len(m[1])
			if skip > 0 && level <= skip {
				skip = 0
			}
			if slices.ContainsFunc(installHeadings, func(h string) bool { return strings.EqualFold(m[2], h) }) {
				skip = level
			}
		}
		if skip == 0 {
			out = append(out, line)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// ShowNotes decides, as magpie starts on current having last run as last
// ("" when it never said), whether to show what changed since, and from
// which version on (exclusive). Only an upgrade between releases shows:
// not a fresh install, the same version again, a downgrade, or a build
// from source. A magpie from before versions were kept has no last; when
// it was already in use (existed) its own version's notes are shown, from
// "", which Between takes as upto's alone.
func ShowNotes(last, current string, existed bool) (after string, show bool) {
	if !Released(current) {
		return "", false
	}
	if last == "" {
		return "", existed
	}
	if !Newer(current, last) {
		return "", false
	}
	return strings.TrimPrefix(strings.TrimSpace(last), "v"), true
}
