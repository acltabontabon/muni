# Security policy

How to report a vulnerability in Muni, and what the project already documents about its security.

## Reporting a vulnerability

Report privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include what is affected, how to reproduce it (with synthetic data), and what an attacker could achieve.

## What to expect

One person maintains Muni, on a best-effort basis. Reports are read, but there is no guaranteed response or fix time, and no bug bounty. If a report is confirmed, the fix lands on `main` and you are credited if you want.

## Scope

In scope: the code in this repository, and the hosted service at `act.munimuni.app`, tested gently with your own accounts and synthetic data.

Please do not:

- access or modify other people's data;
- run denial-of-service attacks or high-volume automated scanning;
- use social engineering;
- test third-party services Muni depends on (Cloudflare, the email provider).

## How Muni protects data

- [docs/architecture.md](docs/architecture.md): the privacy boundary and authorization model.
- [docs/encryption.md](docs/encryption.md): how sprint content is encrypted on participants' devices, and what is not protected.
- [docs/security-review-2026-09.md](docs/security-review-2026-09.md): what was verified, fixed and left open.

Sprints are encrypted on participants' devices by default. The service operator can still link entries to accounts and read sprints set up without encryption. By changing the frontend, the operator could also defeat the encryption.

Muni's encryption has not been independently audited. Reports about the encryption design are especially welcome.
