//! Deterministic provider for tests and credential-free demos. It groups by
//! keyword overlap so the result looks like a plausible draft and is stable
//! for a given input. It also demonstrates the "everything is data" rule by
//! ignoring instruction-like text.

use super::{AiError, AiProvider, InputEntry, Proposal, ProposedTheme};
use async_trait::async_trait;
use std::collections::{HashMap, HashSet};

pub struct FakeProvider;

const STOP: &[&str] = &[
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "we", "our", "it", "is", "was", "were", "that", "this", "with", "at", "be",
    "by", "as", "are", "i", "my", "me", "us", "so", "but", "not", "no", "too", "very", "have", "has", "had", "when", "from", "than", "into",
    "more", "less", "again", "still", "just", "about", "there", "their", "they", "them", "which", "what", "would", "could", "should", "did",
    "do", "does", "get", "got", "one", "two", "some", "all", "any", "much", "many", "been", "being", "each", "every", "also", "then", "out",
    "up", "down", "over", "under", "before", "after", "during", "while", "because", "if", "can", "will", "sprint", "team", "week", "time",
];

fn words(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 3 && !STOP.contains(w))
        .map(|w| w.trim_end_matches('s').to_string())
        .collect()
}

#[async_trait]
impl AiProvider for FakeProvider {
    async fn propose_grouping(&self, entries: &[InputEntry]) -> Result<Proposal, AiError> {
        // Clusters: greedy by Jaccard similarity over content words.
        let sets: Vec<HashSet<String>> = entries.iter().map(|e| words(&format!("{} {} {}", e.body, e.impact.as_deref().unwrap_or(""), e.might_help.as_deref().unwrap_or("")))).collect();
        let mut assigned: Vec<Option<usize>> = vec![None; entries.len()];
        let mut clusters: Vec<Vec<usize>> = vec![];
        for i in 0..entries.len() {
            if assigned[i].is_some() {
                continue;
            }
            let mut c = vec![i];
            assigned[i] = Some(clusters.len());
            for j in (i + 1)..entries.len() {
                if assigned[j].is_some() {
                    continue;
                }
                let inter = sets[i].intersection(&sets[j]).count() as f32;
                let union = sets[i].union(&sets[j]).count().max(1) as f32;
                if inter >= 1.0 && inter / union >= 0.06 {
                    c.push(j);
                    assigned[j] = Some(clusters.len());
                }
            }
            clusters.push(c);
        }
        let mut themes = vec![];
        let mut ungrouped = vec![];
        for c in clusters {
            if c.len() < 2 {
                ungrouped.push(entries[c[0]].id);
                continue;
            }
            let mut freq: HashMap<&str, usize> = HashMap::new();
            for &i in &c {
                for w in &sets[i] {
                    *freq.entry(w.as_str()).or_default() += 1;
                }
            }
            let mut top: Vec<(&str, usize)> = freq.into_iter().filter(|(_, n)| *n >= 2).collect();
            top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            let keywords: Vec<String> = top.iter().take(3).map(|(w, _)| w.to_string()).collect();
            let title = if keywords.is_empty() { "Related observations".to_string() } else { capitalise(&keywords.join(", ")) };
            let cats: HashSet<&str> = c.iter().map(|&i| entries[i].category.as_deref().unwrap_or("unsorted")).collect();
            let mixed = cats.len() > 1;
            let summary = format!(
                "{} observations touch on {}.{}",
                c.len(),
                keywords.join(", "),
                if mixed { " They span more than one category, so some may describe what helped while others describe friction — read both before deciding." } else { "" }
            );
            themes.push(ProposedTheme {
                title: title.clone(),
                summary,
                question: format!("What would make “{}” better next sprint?", title.to_lowercase()),
                draft_experiment: None,
                entry_ids: c.iter().map(|&i| entries[i].id).collect(),
                rephrasings: HashMap::new(),
            });
        }
        let notes = vec!["Draft grouped by shared wording (deterministic local provider). Review every theme; singletons are in Ungrouped on purpose.".into()];
        Ok(Proposal { themes, ungrouped_entry_ids: ungrouped, notes })
    }
    fn label(&self) -> &'static str {
        "fake"
    }
    fn model(&self) -> Option<String> {
        Some("deterministic-fake".into())
    }
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}
