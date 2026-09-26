//! Email delivery. Messages contain neutral links and codes only — never
//! entry content. The capture transport backs tests and the dev inbox.

use crate::config::EmailConfig;
use anyhow::{Context, Result};
use async_trait::async_trait;
use lettre::{
    message::header::ContentType, transport::smtp::authentication::Credentials, AsyncSmtpTransport,
    AsyncTransport, Message, Tokio1Executor,
};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct OutgoingEmail {
    pub to: String,
    pub subject: String,
    pub body: String,
}

#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send(&self, mail: OutgoingEmail) -> Result<()>;
    /// Only the capture transport returns anything; used by tests and the dev inbox.
    fn captured(&self) -> Vec<OutgoingEmail> {
        vec![]
    }
    fn label(&self) -> &'static str;
}

#[derive(Default)]
pub struct CaptureMailer {
    pub inbox: Mutex<Vec<OutgoingEmail>>,
}

#[async_trait]
impl Mailer for CaptureMailer {
    async fn send(&self, mail: OutgoingEmail) -> Result<()> {
        let mut inbox = self.inbox.lock().unwrap();
        inbox.push(mail);
        if inbox.len() > 500 {
            let drain = inbox.len() - 500;
            inbox.drain(0..drain);
        }
        Ok(())
    }
    fn captured(&self) -> Vec<OutgoingEmail> {
        self.inbox.lock().unwrap().clone()
    }
    fn label(&self) -> &'static str {
        "capture"
    }
}

pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: String,
}

impl SmtpMailer {
    pub fn new(host: &str, port: u16, username: Option<String>, password: Option<String>, starttls: bool, from: String) -> Result<Self> {
        let mut builder = if starttls {
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
        };
        builder = builder.port(port);
        if let (Some(u), Some(p)) = (username, password) {
            builder = builder.credentials(Credentials::new(u, p));
        }
        Ok(Self { transport: builder.build(), from })
    }
}

#[async_trait]
impl Mailer for SmtpMailer {
    async fn send(&self, mail: OutgoingEmail) -> Result<()> {
        let msg = Message::builder()
            .from(self.from.parse().context("EMAIL_FROM is not a valid mailbox")?)
            .to(mail.to.parse().context("recipient address")?)
            .subject(mail.subject)
            .header(ContentType::TEXT_PLAIN)
            .body(mail.body)?;
        self.transport.send(msg).await.context("smtp send")?;
        Ok(())
    }
    fn label(&self) -> &'static str {
        "smtp"
    }
}

pub fn build(cfg: &EmailConfig) -> Result<Arc<dyn Mailer>> {
    Ok(match cfg {
        EmailConfig::Capture => Arc::new(CaptureMailer::default()),
        EmailConfig::Smtp { host, port, username, password, starttls, from } => Arc::new(SmtpMailer::new(
            host,
            *port,
            username.clone(),
            password.clone(),
            *starttls,
            from.clone(),
        )?),
    })
}

/// Templates. Plain text on purpose: readable everywhere, nothing to inject into.
pub mod templates {
    use super::OutgoingEmail;

    pub fn sign_in_code(to: &str, code: &str) -> OutgoingEmail {
        OutgoingEmail {
            to: to.into(),
            subject: format!("{code} is your Muni sign-in code"),
            body: format!(
                "Your Muni sign-in code is:\n\n    {code}\n\nIt expires in 10 minutes and works once.\n\nIf you didn’t request this, you can ignore this email.\n"
            ),
        }
    }

    pub fn invitation(to: &str, workspace: &str, inviter: &str, link: &str) -> OutgoingEmail {
        OutgoingEmail {
            to: to.into(),
            subject: format!("{inviter} invited you to {workspace} on Muni"),
            body: format!(
                "{inviter} invited you to join the “{workspace}” workspace on Muni.\n\nOpen this invitation and confirm this email address to join:\n\n    {link}\n\nThis invitation is for {to} only and expires in 14 days. Forwarding the link does not let someone else join.\n"
            ),
        }
    }

    pub fn reminder(to: &str, sprint: &str, kind: &str, link: &str) -> OutgoingEmail {
        let line = match kind {
            "midpoint" => "You’re halfway through the sprint. If something is worth remembering for the retro, this is a good moment to note it.",
            _ => "The retro is tomorrow. Anything from this sprint worth bringing? Add it while it’s fresh.",
        };
        OutgoingEmail {
            to: to.into(),
            subject: format!("A note for the {sprint} retro?"),
            body: format!("{line}\n\nOpen the sprint:\n\n    {link}\n\nYou can turn these reminders off from the sprint page.\n"),
        }
    }
}
