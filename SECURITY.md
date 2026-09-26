# Security policy

> **Maintainer note — remove when publishing:** GitHub's private vulnerability reporting is not
> available while this repository is private. Enabling it is a prerequisite for making the
> repository public; until then the reporting route below does not exist yet.

## Reporting a vulnerability

Please report security problems privately, through GitHub's private vulnerability reporting:
open this repository's **Security** tab and choose **Report a vulnerability**. Don't open a public
issue or pull request for a suspected vulnerability.

Helpful to include: what is affected, how to reproduce it (with synthetic data), and what an
attacker could achieve.

## What to expect

Muni is maintained by one person on a best-effort basis. Reports are read, but there is no
guaranteed response or fix time, and there is no bug bounty. If a report is confirmed, the fix is
made on `main` and credited to you if you'd like.

## Scope

In scope: the code in this repository, and the hosted pilot at `act.munimuni.app` when tested
gently — use your own accounts and synthetic data only.

Please don't: access or modify other people's data, run denial-of-service or high-volume
automated scanning, use social engineering, or test third-party services Muni depends on
(Cloudflare, the email provider).

## How Muni protects data

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the privacy boundary and authorization
model; [`docs/security-review-2026-09.md`](docs/security-review-2026-09.md) records what was
verified, what was fixed and what remains open. Muni's privacy is application-level: it is not
end-to-end encrypted, and the service operator could technically associate entries with accounts.
