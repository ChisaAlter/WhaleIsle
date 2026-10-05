package redact

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

// kept are the keys whose strings are left alone: ids, names and kinds the
// vendor needs as they are, and what is sealed or encoded (a thinking
// block's signature, reasoning's encrypted content, an image's data).
var kept = map[string]bool{
	"signature": true, "encrypted_content": true, "data": true, "thoughtSignature": true, "thought_signature": true,
	"model": true, "id": true, "tool_use_id": true, "call_id": true, "item_id": true, "type": true, "role": true,
	"name": true, "previous_response_id": true, "prompt_cache_key": true, "media_type": true, "mime_type": true,
	"mimeType": true, "url": true, "image_url": true, "file_id": true, "reasoning_effort": true, "effort": true,
	"stop_reason": true, "finish_reason": true, "status": true, "object": true, "event": true,
}

func keep(key, s string) bool {
	return kept[key] || strings.HasPrefix(s, "data:")
}

// walk calls fn with every string value in the JSON document b — its path
// (keys and indexes joined by dots) and the key it is under — and writes
// what fn returns in its place. Everything else is kept byte for byte, and
// b comes back as it is if nothing changed; if it isn't JSON, ok is false.
func walk(b []byte, fn func(path, key, s string) string) (out []byte, ok bool) {
	w := walker{in: b, fn: fn}
	i, good := w.value(w.ws(0), "", "")
	if !good || w.ws(i) != len(b) {
		return b, false
	}
	if w.last == 0 {
		return b, true
	}
	w.out.Write(b[w.last:])
	return w.out.Bytes(), true
}

type walker struct {
	in   []byte
	out  bytes.Buffer
	last int
	fn   func(path, key, s string) string
}

func (w *walker) ws(i int) int {
	for i < len(w.in) && (w.in[i] == ' ' || w.in[i] == '\t' || w.in[i] == '\n' || w.in[i] == '\r') {
		i++
	}
	return i
}

func join(path, k string) string {
	if path == "" {
		return k
	}
	return path + "." + k
}

// str is the end of the string literal that starts at i.
func (w *walker) str(i int) (end int, escaped, ok bool) {
	for j := i + 1; j < len(w.in); j++ {
		switch w.in[j] {
		case '\\':
			escaped = true
			j++
		case '"':
			return j + 1, escaped, true
		}
	}
	return 0, false, false
}

func (w *walker) value(i int, path, key string) (int, bool) {
	if i >= len(w.in) {
		return i, false
	}
	switch c := w.in[i]; c {
	case '{':
		i = w.ws(i + 1)
		if i < len(w.in) && w.in[i] == '}' {
			return i + 1, true
		}
		for {
			if i >= len(w.in) || w.in[i] != '"' {
				return i, false
			}
			end, esc, ok := w.str(i)
			if !ok {
				return i, false
			}
			k := string(w.in[i+1 : end-1])
			if esc {
				if json.Unmarshal(w.in[i:end], &k) != nil {
					return i, false
				}
			}
			i = w.ws(end)
			if i >= len(w.in) || w.in[i] != ':' {
				return i, false
			}
			if i, ok = w.value(w.ws(i+1), join(path, k), k); !ok {
				return i, false
			}
			i = w.ws(i)
			if i < len(w.in) && w.in[i] == ',' {
				i = w.ws(i + 1)
				continue
			}
			if i < len(w.in) && w.in[i] == '}' {
				return i + 1, true
			}
			return i, false
		}
	case '[':
		i = w.ws(i + 1)
		if i < len(w.in) && w.in[i] == ']' {
			return i + 1, true
		}
		for n := 0; ; n++ {
			var ok bool
			// an array's strings are under the key the array is
			if i, ok = w.value(i, join(path, strconv.Itoa(n)), key); !ok {
				return i, false
			}
			i = w.ws(i)
			if i < len(w.in) && w.in[i] == ',' {
				i = w.ws(i + 1)
				continue
			}
			if i < len(w.in) && w.in[i] == ']' {
				return i + 1, true
			}
			return i, false
		}
	case '"':
		end, esc, ok := w.str(i)
		if !ok {
			return i, false
		}
		s := string(w.in[i+1 : end-1])
		if esc && json.Unmarshal(w.in[i:end], &s) != nil {
			return i, false
		}
		if t := w.fn(path, key, s); t != s {
			w.out.Write(w.in[w.last:i])
			w.out.WriteByte('"')
			w.out.WriteString(jsonEscape(t))
			w.out.WriteByte('"')
			w.last = end
		}
		return end, true
	default:
		j := i
		for j < len(w.in) && !strings.ContainsRune(",]} \t\r\n", rune(w.in[j])) {
			j++
		}
		if j == i {
			return i, false
		}
		return j, true
	}
}

// jsonEscape is s as it goes between the quotes of a JSON string.
func jsonEscape(s string) string {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(s)
	out := b.Bytes()
	return string(out[1 : len(out)-2]) // the quotes and the newline
}

// MaskJSON masks the strings of a request body, and says how many values
// it masked. A body that isn't JSON is masked as text.
func MaskJSON(body []byte, o Options) ([]byte, int) {
	total := 0
	out, ok := walk(body, func(_, key, s string) string {
		if keep(key, s) {
			return s
		}
		t, n := Mask(s, o)
		total += n
		return t
	})
	if !ok {
		t, n := Mask(string(body), o)
		return []byte(t), n
	}
	return out, total
}

// asJSON says a string under key holds JSON text of its own, so a value
// put back in it goes in escaped: a tool call's arguments, as a whole or
// streamed in pieces.
func asJSON(key, eventType string) bool {
	return key == "arguments" || key == "partial_json" || key == "delta" && strings.Contains(eventType, "arguments")
}

// RestoreJSON puts the values back in a response body.
func RestoreJSON(body []byte) []byte {
	if !bytes.Contains(body, []byte("{{")) {
		return body
	}
	typ := ""
	out, ok := walk(body, func(path, key, s string) string {
		if path == "type" {
			typ = s
		}
		return Restore(s, asJSON(key, typ))
	})
	if !ok {
		return []byte(Restore(string(body), false))
	}
	return out
}
