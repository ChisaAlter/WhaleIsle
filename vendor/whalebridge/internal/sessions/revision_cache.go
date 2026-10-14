package sessions

import (
	"sort"
	"time"
)

// Each cache retains at most eight files and 8192 index entries.
// Recent sources take priority over idle windows, then compete by reparse
// cost (source size). Cold-only historical Claude sources keep no window;
// an already retained idle window can use spare capacity. Codex still expires.
const revisionIdle = 5 * time.Minute
const revisionFiles = 8
const revisionEntries = 8192

// A pause longer than five minutes must not demote a large working session
// behind tiny subagent logs. After an hour, recent work takes priority; idle
// Claude windows are not discarded unless that capacity is actually needed.
const revisionWorking = time.Hour

func workingRevision(mod int64, now time.Time) bool {
	return mod >= now.Add(-revisionWorking).UnixNano()
}

func recentRevision(mod int64, weight int, now time.Time) bool {
	return weight > 0 && weight <= revisionEntries && mod >= now.Add(-revisionIdle).UnixNano()
}

func (s *codexUsageState) weight() int {
	if s == nil {
		return 0
	}
	return len(s.Entries) + len(s.Intervals) + len(s.Responses) + len(s.Models) + len(s.Compactions) + len(s.CounterBases)
}
func (s *claudeUsageState) weight() int {
	if s == nil {
		return 0
	}
	n := len(s.Messages)
	for _, branches := range s.Messages {
		for _, m := range branches {
			n += 1 + len(m.Previous) + len(m.Tools) + len(m.Blocks)
			for _, tool := range m.Tools {
				n += len(tool.Previous)
			}
			if n > revisionEntries {
				return n
			}
		}
	}
	return n
}
func (s *state) revisionWeight() int { return s.Codex.weight() + s.Claude.weight() }
func (s *state) withoutRevisions() *state {
	if s.Codex == nil && s.Claude == nil {
		return s
	}
	c := *s
	c.Codex, c.Claude = nil, nil
	return &c
}
func (s *callFile) revisionWeight() int {
	if s.CX == nil {
		return s.Claude.weight()
	}
	return s.Claude.weight() + s.CX.Usage.weight() + len(s.CX.Contexts) + len(s.CX.Turns) + len(s.CX.Timings)
}
func (s *callFile) withoutRevisions() *callFile {
	if s.CX == nil && s.Claude == nil {
		return s
	}
	c := *s
	c.CX, c.Claude = nil, nil
	return &c
}

type revisionCandidate struct {
	path    string
	mod     int64
	weight  int
	size    int64
	bounded bool
}

func (c revisionCandidate) eligible(now time.Time) bool {
	if c.bounded {
		return c.weight > 0 && c.weight <= claudeRevisionEntries
	}
	return recentRevision(c.mod, c.weight, now)
}

// Called with mu held. Reserve only windows already in memory or about to be
// parsed; an unchanged disk-only summary must not take a phantom cache slot.
func summaryRevisionWindows(todo []file, now time.Time) map[string]bool {
	candidates := make(map[string]revisionCandidate)
	for path, s := range cache {
		if s.Claude != nil {
			candidates[path] = revisionCandidate{path: path, mod: s.Mod, weight: claudeRevisionEntries, size: s.Size, bounded: true}
		}
	}
	for _, f := range todo {
		_, retained := candidates[f.path]
		if parserFor(f.agent).claude && (retained || workingRevision(f.mod.UnixNano(), now)) {
			candidates[f.path] = revisionCandidate{path: f.path, mod: f.mod.UnixNano(), weight: claudeRevisionEntries, size: f.size, bounded: true}
		}
	}
	ranked := make([]revisionCandidate, 0, len(candidates))
	for _, c := range candidates {
		ranked = append(ranked, c)
	}
	return retainedRevisions(ranked, now)
}

func retainedRevisions(candidates []revisionCandidate, now time.Time) map[string]bool {
	sort.Slice(candidates, func(i, j int) bool {
		recentI, recentJ := workingRevision(candidates[i].mod, now), workingRevision(candidates[j].mod, now)
		if recentI != recentJ {
			return recentI
		}
		if candidates[i].size != candidates[j].size {
			return candidates[i].size > candidates[j].size
		}
		if candidates[i].mod != candidates[j].mod {
			return candidates[i].mod > candidates[j].mod
		}
		return candidates[i].path < candidates[j].path
	})
	keep := map[string]bool{}
	used := 0
	for _, c := range candidates {
		if !c.eligible(now) || len(keep) == revisionFiles || used+c.weight > revisionEntries {
			continue
		}
		keep[c.path] = true
		used += c.weight
	}
	return keep
}

// Called with mu held. Replace snapshots instead of mutating them: a parser
// may still be reading the previous snapshot outside the metadata lock.
func trimSummaryRevisions(now time.Time) {
	var candidates []revisionCandidate
	for path, s := range cache {
		if n := s.revisionWeight(); n > 0 {
			candidates = append(candidates, revisionCandidate{path: path, mod: s.Mod, weight: n, size: s.Size, bounded: s.Claude != nil})
		}
	}
	keep := retainedRevisions(candidates, now)
	for _, c := range candidates {
		if !keep[c.path] {
			cache[c.path] = cache[c.path].withoutRevisions()
		}
	}
}

// Called with callsMu held. The row cache and compact continuation cache have
// independent fixed bounds. A disk shard without a window stays disk-only.
func trimCallRevisions(now time.Time) {
	var candidates []revisionCandidate
	for path, s := range callCache {
		if n := s.revisionWeight(); n > 0 {
			candidates = append(candidates, revisionCandidate{path: path, mod: s.Mod, weight: n, size: s.Size, bounded: s.Claude != nil})
		}
	}
	keep := retainedRevisions(candidates, now)
	for _, c := range candidates {
		if !keep[c.path] {
			callCache[c.path] = callCache[c.path].withoutRevisions()
		}
	}
	candidates = candidates[:0]
	for path, entry := range callContinuations {
		candidates = append(candidates, revisionCandidate{path: path, mod: entry.state.Mod, weight: entry.state.revisionWeight(), size: entry.state.Size, bounded: entry.state.Claude != nil})
	}
	keep = retainedRevisions(candidates, now)
	order := callContinuationOrder[:0]
	for _, path := range callContinuationOrder {
		if keep[path] {
			order = append(order, path)
		} else {
			delete(callContinuations, path)
		}
	}
	callContinuationOrder = order
}
