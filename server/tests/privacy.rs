//! The privacy boundary, tested from the outside.
mod common;
use common::*;
use reqwest::StatusCode;
use serde_json::{json, Value};

fn walk(v: &Value, f: &mut dyn FnMut(&str, &Value)) {
    match v {
        Value::Object(m) => {
            for (k, val) in m {
                f(k, val);
                walk(val, f);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| walk(x, f)),
        _ => {}
    }
}

/// Any shared payload must not carry these keys next to entry text.
const FORBIDDEN_KEYS: &[&str] = &["author", "author_account_id", "account_id", "email", "created_at", "updated_at", "ip", "user_agent", "alias", "avatar"];

fn assert_no_author_fields(payload: &Value, context: &str) {
    // Entries are objects with a "body" key; check their keys and their siblings.
    walk(payload, &mut |k, v| {
        if let Value::Object(m) = v {
            if m.contains_key("body") && m.contains_key("category") {
                for key in m.keys() {
                    assert!(!FORBIDDEN_KEYS.contains(&key.as_str()), "{context}: entry object carries `{key}`");
                }
            }
        }
        let _ = k;
    });
}

#[tokio::test]
async fn entries_are_sealed_during_collection_even_for_the_facilitator() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(2).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    h.entry(&members[0], sprint, "improve", "secret while collecting").await;
    // Facilitator: no shared listing, no themes, no export, no aggregate count.
    let (s, _) = h.get(&owner, &format!("/api/sprints/{sprint}/entries")).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = h.get(&owner, &format!("/api/sprints/{sprint}/themes")).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = h.get_text(&owner, &format!("/api/sprints/{sprint}/export.md?scope=raw")).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (_, d) = h.get(&owner, &format!("/api/sprints/{sprint}")).await;
    assert!(d["entry_count"].is_null(), "no counts during collection");
    // The facilitator's "mine" is only theirs.
    let (_, mine) = h.get(&owner, &format!("/api/sprints/{sprint}/entries/mine")).await;
    assert_eq!(mine.as_array().unwrap().len(), 0);
    // Another participant sees only their own.
    let (_, mine1) = h.get(&members[1], &format!("/api/sprints/{sprint}/entries/mine")).await;
    assert_eq!(mine1.as_array().unwrap().len(), 0);
    let (_, mine0) = h.get(&members[0], &format!("/api/sprints/{sprint}/entries/mine")).await;
    assert_eq!(mine0.as_array().unwrap().len(), 1);
    // No SSE hint is emitted for submissions during collection.
    let h2 = h.handle();
    let o = owner.clone();
    let stream = tokio::spawn(async move { h2.sse(&o, sprint, 1500).await });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    h.entry(&members[1], sprint, "keep", "another sealed one").await;
    let (_, text) = stream.await.unwrap();
    assert!(!text.contains("entries"), "no per-submission hint during collection: {text}");
}

#[tokio::test]
async fn shared_representations_carry_no_authorship_anywhere() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(3).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    let needle = "=HYPERLINK(\"x\") unique-needle-7431";
    h.entry(&members[0], sprint, "improve", needle).await;
    h.entry(&members[1], sprint, "keep", "second entry").await;
    h.entry(&members[2], sprint, "try", "third entry").await;
    h.close_collection(&owner, sprint).await;

    // REST: shared entries and themes.
    let (s, entries) = h.get(&members[2], &format!("/api/sprints/{sprint}/entries")).await;
    assert_eq!(s, StatusCode::OK);
    assert_no_author_fields(&entries, "entries");
    let (_, g) = h.get(&owner, &format!("/api/sprints/{sprint}/themes")).await;
    assert_no_author_fields(&g, "themes");
    let (_, g2) = h.post(&owner, &format!("/api/sprints/{sprint}/themes"), json!({"title": "T", "entry_ids": ids(&entries)})).await;
    assert_no_author_fields(&g2, "themes after grouping");
    // Order is randomised, not insertion order (reveal_order was assigned).
    let (order,): (i64,) = sqlx::query_as("SELECT count(DISTINCT reveal_order) FROM entries WHERE sprint_id = $1").bind(sprint).fetch_one(&h.state.db).await.unwrap();
    assert_eq!(order, 3);

    // Exports: no emails/names, formula-safe CSV.
    h.go(&owner, sprint, "ready").await;
    let (_, csv) = h.get_text(&owner, &format!("/api/sprints/{sprint}/export.csv?scope=raw")).await;
    assert!(csv.contains("'=HYPERLINK"), "formula must be neutralised: {csv}");
    for m in &members {
        assert!(!csv.contains(&m.email), "csv leaks email");
        assert!(!csv.contains("Member "), "csv leaks names");
    }
    let (_, md) = h.get_text(&owner, &format!("/api/sprints/{sprint}/export.md?scope=raw")).await;
    for m in &members {
        assert!(!md.contains(&m.email));
    }
    assert!(!md.contains("2026-09-"), "no timestamps in export: {md}");
    // Summary export by default excludes raw bodies.
    let (_, md_summary) = h.get_text(&members[0], &format!("/api/sprints/{sprint}/export.md")).await;
    assert!(!md_summary.contains("unique-needle"), "summary export must not include raw notes");
    // Raw export is facilitator-only.
    let (s, _) = h.get_text(&members[0], &format!("/api/sprints/{sprint}/export.md?scope=raw")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // SSE: hints only. Trigger a change while streaming and inspect the payload.
    let h2 = h.handle();
    let m = members[0].clone();
    let stream = tokio::spawn(async move { h2.sse(&m, sprint, 1200).await });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    h.post(&owner, &format!("/api/sprints/{sprint}/themes"), json!({"title": "Another"})).await;
    let (_, text) = stream.await.unwrap();
    assert!(text.contains("\"resource\":\"themes\""), "hint expected: {text}");
    assert!(!text.contains("unique-needle") && !text.contains("Another"), "SSE must carry no content: {text}");

    // Audit log: ids only.
    let (_, audit) = h.get(&owner, &format!("/api/workspaces/{ws}/audit")).await;
    assert!(!audit.to_string().contains("unique-needle"));
}

#[tokio::test]
async fn votes_stay_private_until_the_round_closes_and_never_name_voters() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(2).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    h.entry(&members[0], sprint, "improve", "a").await;
    h.close_collection(&owner, sprint).await;
    let (_, entries) = h.get(&owner, &format!("/api/sprints/{sprint}/entries")).await;
    let (_, g) = h.post(&owner, &format!("/api/sprints/{sprint}/themes"), json!({"title": "T", "entry_ids": ids(&entries)})).await;
    let theme = g["themes"][0]["id"].as_str().unwrap().to_string();
    h.go(&owner, sprint, "ready").await;
    h.post(&owner, &format!("/api/sprints/{sprint}/votes/rounds"), json!({})).await;
    h.post(&members[0], &format!("/api/sprints/{sprint}/votes"), json!({"theme_id": theme, "cast": true})).await;
    // While open: the other member sees no totals and not the voter's choice.
    let (_, v) = h.get(&members[1], &format!("/api/sprints/{sprint}/votes")).await;
    assert!(v["current"]["totals"].is_null());
    assert_eq!(v["current"]["my_votes"].as_array().unwrap().len(), 0);
    let (_, g) = h.get(&owner, &format!("/api/sprints/{sprint}/themes")).await;
    assert!(g["themes"][0]["votes"].is_null());
    // After close: totals only.
    h.post(&owner, &format!("/api/sprints/{sprint}/votes/rounds/close"), json!({"action": "close"})).await;
    let (_, v) = h.get(&members[1], &format!("/api/sprints/{sprint}/votes")).await;
    let totals = &v["previous"][0]["totals"];
    assert_eq!(totals[&theme], 1);
    assert!(!v.to_string().contains(&members[0].account_id.to_string()), "voter id must not appear");
}

#[tokio::test]
async fn logs_and_error_responses_never_echo_entry_bodies() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(1).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    // An oversized body triggers an error path.
    let big = "log-needle-9182 ".repeat(200);
    let (s, body) = h.post(&members[0], &format!("/api/sprints/{sprint}/entries"), json!({"category": "improve", "body": big})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(!body.to_string().contains("log-needle"), "error must not echo the body");
    // A conflict path (closed collection) likewise.
    h.entry(&members[0], sprint, "keep", "fine").await;
    h.close_collection(&owner, sprint).await;
    let (s, body) = h.post(&members[0], &format!("/api/sprints/{sprint}/entries"), json!({"category": "improve", "body": "late-needle-3311"})).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(!body.to_string().contains("late-needle"));
}

#[tokio::test]
async fn ai_input_contains_text_and_ids_only() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(1).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    h.entry(&members[0], sprint, "improve", "ai-input needle").await;
    h.close_collection(&owner, sprint).await;
    let (s, _) = h.post(&owner, &format!("/api/sprints/{sprint}/ai/grouping"), json!({})).await;
    assert_eq!(s, StatusCode::OK);
    let (snapshot,): (Value,) = sqlx::query_as("SELECT input_snapshot FROM ai_jobs WHERE sprint_id = $1").bind(sprint).fetch_one(&h.state.db).await.unwrap();
    let text = snapshot.to_string();
    assert!(text.contains("ai-input needle"));
    assert!(!text.contains(&members[0].email) && !text.contains(&members[0].account_id.to_string()) && !text.contains("Member 0"));
    for key in ["author", "account", "email", "created_at"] {
        assert!(!text.contains(key), "snapshot carries {key}");
    }
}
