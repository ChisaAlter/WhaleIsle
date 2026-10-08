package davsync

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// signer signs a request with AWS Signature Version 4, as every
// S3-compatible server checks it: by hand, a few dozen lines, rather than
// an SDK for the three requests sync makes.
type signer struct {
	id, secret, region, service string
}

// sign sets req's X-Amz-Date and Authorization, over every header req has
// at this point and its host. payload is the body's SHA-256, in hex; an S3
// server wants it in X-Amz-Content-Sha256 too, which the caller sets.
func (s signer) sign(req *http.Request, payload string, t time.Time) {
	stamp := t.UTC().Format("20060102T150405Z")
	day := stamp[:8]
	req.Header.Set("X-Amz-Date", stamp)

	host := req.Host
	if host == "" {
		host = req.URL.Host
	}
	headers := map[string]string{"host": host}
	for k, vs := range req.Header {
		k = strings.ToLower(k)
		if k == "authorization" {
			continue
		}
		vals := make([]string, len(vs))
		for i, v := range vs {
			vals[i] = strings.Join(strings.Fields(v), " ")
		}
		headers[k] = strings.Join(vals, ",")
	}
	names := slices.Sorted(maps.Keys(headers))
	var canon strings.Builder
	for _, k := range names {
		canon.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")

	uri := req.URL.EscapedPath()
	if uri == "" {
		uri = "/"
	}
	request := strings.Join([]string{req.Method, uri, canonicalQuery(req.URL), canon.String(), signed, payload}, "\n")
	scope := day + "/" + s.region + "/" + s.service + "/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + sum([]byte(request))

	key := mac([]byte("AWS4"+s.secret), day)
	key = mac(key, s.region)
	key = mac(key, s.service)
	key = mac(key, "aws4_request")
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.id+"/"+scope+
		", SignedHeaders="+signed+", Signature="+hex.EncodeToString(mac(key, toSign)))
}

// canonicalQuery is the query, each name and value escaped as AWS does,
// sorted: ?lifecycle is "lifecycle=".
func canonicalQuery(u *url.URL) string {
	q := u.Query()
	var out []string
	for k, vs := range q {
		for _, v := range vs {
			out = append(out, awsEscape(k, false)+"="+awsEscape(v, false))
		}
	}
	slices.Sort(out)
	return strings.Join(out, "&")
}

// awsEscape is URI encoding as SigV4 has it: all but A–Z a–z 0–9 - _ . ~
// as %XX, upper case, and / kept in a path.
func awsEscape(s string, path bool) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9', c == '-', c == '_', c == '.', c == '~', path && c == '/':
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&15])
		}
	}
	return b.String()
}

func mac(key []byte, s string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(s))
	return h.Sum(nil)
}
