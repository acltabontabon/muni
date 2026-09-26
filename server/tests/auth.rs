mod common;
use common::*;
use reqwest::StatusCode;
use serde_json::json;

#[tokio::test]
async fn wrong_code_is_rejected_and_attempts_are_bounded() {
    let h = Harness::new().await;
    let email = format!("bounded-{}@example.com", uuid::Uuid::new_v4().simple());
    h.post_anon("/api/auth/request-code", json!({"email": email})).await;
    for _ in 0..5 {
        let r = h.verify(&email, "000000", "X").await;
        assert!(r.is_err());
    }
    // The right code no longer works: the challenge is exhausted.
    let code = h.code_for(&email);
    let r = h.verify(&email, &code, "X").await;
    assert!(r.is_err(), "exhausted challenge must not verify");
    // A fresh code works once and only once (replay).
    h.post_anon("/api/auth/request-code", json!({"email": email})).await;
    let code = h.code_for(&email);
    assert!(h.verify(&email, &code, "X").await.is_ok());
    assert!(h.verify(&email, &code, "X").await.is_err(), "replayed code must fail");
}

#[tokio::test]
async fn code_requests_are_rate_limited_per_address() {
    let h = Harness::new().await;
    let email = format!("rl-{}@example.com", uuid::Uuid::new_v4().simple());
    for _ in 0..5 {
        let (s, _) = h.post_anon("/api/auth/request-code", json!({"email": email})).await;
        assert_eq!(s, StatusCode::OK);
    }
    let (s, _) = h.post_anon("/api/auth/request-code", json!({"email": email})).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn protected_routes_need_a_session_and_mutations_need_csrf() {
    let h = Harness::new().await;
    let (s, _) = h.get_anon("/api/auth/me").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = h.get_anon("/api/me/capture-target").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let u = h.signin(&format!("csrf-{}@example.com", uuid::Uuid::new_v4().simple()), "C").await;
    // Session cookie but no CSRF header.
    let r = h.http.post(format!("{}/api/workspaces", h.base)).header("cookie", format!("muni_session={}", u.session)).header("origin", "http://localhost:5173").json(&json!({"name": "x"})).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    // Cross-site origin is refused even with a valid CSRF header.
    let r = h.http.post(format!("{}/api/workspaces", h.base)).header("cookie", format!("muni_session={}", u.session)).header("x-csrf-token", &u.csrf).header("origin", "https://evil.example").json(&json!({"name": "x"})).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    let (s, _) = h.post(&u, "/api/workspaces", json!({"name": "ok"})).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn logout_revokes_the_session_and_other_devices_can_be_signed_out() {
    let h = Harness::new().await;
    let email = format!("lo-{}@example.com", uuid::Uuid::new_v4().simple());
    let a = h.signin(&email, "A").await;
    let b = h.signin(&email, "A").await; // second device, same account
    assert_eq!(a.account_id, b.account_id);
    let (s, _) = h.post(&a, "/api/auth/logout-others", json!({})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = h.get(&b, "/api/auth/me").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = h.post(&a, "/api/auth/logout", json!({})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = h.get(&a, "/api/auth/me").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invitation_is_bound_to_the_recipient_single_use_and_revocable() {
    let h = Harness::new().await;
    let (owner, _, ws) = h.team(0).await;
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let invited = format!("invitee-{tag}@example.com");
    h.post(&owner, &format!("/api/workspaces/{ws}/invitations"), json!({"email": invited})).await;
    let token = h.invite_token(&invited).await;
    // Preview without a session reveals only a masked address, never the workspace name.
    let (s, p) = h.get_anon(&format!("/api/invitations/{token}")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(p["valid"], true);
    assert!(p["workspace_name"].is_null());
    assert!(p["email_hint"].as_str().unwrap().contains("•••"));
    // Forwarded: a different verified person cannot accept it.
    let stranger = h.signin(&format!("stranger-{tag}@example.com"), "S").await;
    let (s, _) = h.post(&stranger, &format!("/api/invitations/{token}/accept"), json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = h.get(&stranger, &format!("/api/workspaces/{ws}")).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "stranger must not be a member");
    // The right person can, once.
    let right = h.signin(&invited, "R").await;
    let (s, _) = h.post(&right, &format!("/api/invitations/{token}/accept"), json!({})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = h.post(&right, &format!("/api/invitations/{token}/accept"), json!({})).await;
    assert_ne!(s, StatusCode::OK, "replayed invitation must fail");
    // Garbage / expired-looking tokens are invalid.
    let (_, p) = h.get_anon("/api/invitations/not-a-real-token").await;
    assert_eq!(p["valid"], false);
    // Revoked invitations stop working.
    let second = format!("second-{tag}@example.com");
    let (_, inv) = h.post(&owner, &format!("/api/workspaces/{ws}/invitations"), json!({"email": second})).await;
    let token2 = h.invite_token(&second).await;
    h.delete(&owner, &format!("/api/workspaces/{ws}/invitations/{}", inv["invitation_id"].as_str().unwrap())).await;
    let (_, p) = h.get_anon(&format!("/api/invitations/{token2}")).await;
    assert_eq!(p["valid"], false);
}

#[tokio::test]
async fn expired_invitations_are_refused() {
    let h = Harness::new().await;
    let (owner, _, ws) = h.team(0).await;
    let email = format!("exp-{}@example.com", uuid::Uuid::new_v4().simple());
    h.post(&owner, &format!("/api/workspaces/{ws}/invitations"), json!({"email": email})).await;
    let token = h.invite_token(&email).await;
    sqlx::query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = $1").bind(&email).execute(&h.state.db).await.unwrap();
    let u = h.signin(&email, "E").await;
    let (s, _) = h.post(&u, &format!("/api/invitations/{token}/accept"), json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn revoked_members_lose_api_access_and_their_sse_stream_closes() {
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(1).await;
    let m = &members[0];
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    let (s, _) = h.get(m, &format!("/api/sprints/{sprint}")).await;
    assert_eq!(s, StatusCode::OK);
    // Open a stream, then revoke while it is open.
    let h2 = h.handle();
    let m2 = m.clone();
    let stream = tokio::spawn(async move { h2.sse(&m2, sprint, 3000).await });
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let (s, _) = h.delete(&owner, &format!("/api/workspaces/{ws}/members/{}", m.account_id)).await;
    assert_eq!(s, StatusCode::OK);
    let (status, text) = stream.await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert!(text.contains("event: revoked"), "stream should announce revocation: {text}");
    // Subsequent API access fails; new SSE subscriptions are refused.
    let (s, _) = h.get(m, &format!("/api/sprints/{sprint}")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = h.get(m, &format!("/api/workspaces/{ws}")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = h.sse(m, sprint, 200).await;
    assert_ne!(s, StatusCode::OK);
}

#[tokio::test]
async fn cross_workspace_access_is_denied_without_confirming_existence() {
    let h = Harness::new().await;
    let (owner_a, members_a, ws_a) = h.team(1).await;
    let (owner_b, _, ws_b) = h.team(0).await;
    let sprint_a = h.sprint(&owner_a, &members_a, ws_a, "collecting").await;
    let (s, _) = h.get(&owner_b, &format!("/api/sprints/{sprint_a}")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = h.get(&owner_b, &format!("/api/sprints/{sprint_a}/entries/mine")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = h.post(&owner_b, &format!("/api/sprints/{sprint_a}/entries"), json!({"body": "x"})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = h.get(&owner_b, &format!("/api/workspaces/{ws_a}")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = h.get(&owner_a, &format!("/api/workspaces/{ws_b}/sprints")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // A member who is not a sprint participant can't read it either.
    let (owner_c, members_c, ws_c) = h.team(2).await;
    let sprint_c = h.sprint(&owner_c, &members_c[..1], ws_c, "collecting").await;
    let (s, _) = h.get(&members_c[1], &format!("/api/sprints/{sprint_c}")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn workspace_owner_gets_no_author_lookup() {
    // There is simply no route; assert the obvious candidates 404.
    let h = Harness::new().await;
    let (owner, members, ws) = h.team(1).await;
    let sprint = h.sprint(&owner, &members, ws, "collecting").await;
    let e = h.entry(&members[0], sprint, "improve", "who wrote this").await;
    h.close_collection(&owner, sprint).await;
    let id = e["id"].as_str().unwrap();
    for path in [format!("/api/sprints/{sprint}/entries/{id}/author"), format!("/api/entries/{id}"), format!("/api/workspaces/{ws}/entries"), format!("/api/sprints/{sprint}/entries/{id}")] {
        let (s, _) = h.get(&owner, &path).await;
        assert!(s == StatusCode::NOT_FOUND || s == StatusCode::METHOD_NOT_ALLOWED, "{path} -> {s}");
    }
}
