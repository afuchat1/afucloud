import type { Env } from "../types";

export type EmailTemplateKey =
  | "welcome"
  | "domain_verified"
  | "domain_registered"
  | "domain_registration_review"
  | "domain_registration_refunded"
  | "domain_expiry_reminder"
  | "domain_expired";

export interface EmailOutboxMessage {
  id: string;
  event_key: string;
  recipient_email: string;
  recipient_name: string | null;
  template_key: EmailTemplateKey;
  payload: Record<string, unknown> | null;
  attempts: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SITE_URL = "https://cloud.afuchat.com";
const LOGO_URL = `${SITE_URL}/afucloud-email-logo.png`;
const FROM = "AfuCloud <no-reply@afuchat.com>";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanText(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength) || fallback;
}

function formatDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function emailCopy(template: EmailTemplateKey, payload: Record<string, unknown>, recipientName: string | null) {
  const name = escapeHtml(cleanText(recipientName, "there", 80));
  const domain = escapeHtml(cleanText(payload.domain, "your domain", 253));
  const expires = formatDate(payload.expiresAt);
  const expiryLine = expires ? `The current registration expires on ${escapeHtml(expires)}.` : "";
  const rawDays = Number(payload.daysUntilExpiry);
  const days = Number.isFinite(rawDays) ? Math.max(0, Math.floor(rawDays)) : 1;

  switch (template) {
    case "welcome":
      return {
        subject: "Welcome to AfuCloud",
        preheader: "Your AfuCloud account is ready.",
        title: `Welcome, ${name}`,
        paragraphs: [
          "Your email is confirmed and your AfuCloud account is ready.",
          "Manage your image delivery, connected domains, and account settings from your dashboard.",
        ],
        action: { label: "Open AfuCloud", url: `${SITE_URL}/dashboard` },
      };
    case "domain_verified":
      return {
        subject: `${cleanText(payload.domain, "Your domain", 180)} is verified`,
        preheader: "AfuCloud confirmed ownership of your domain.",
        title: "Domain verified",
        paragraphs: [
          `AfuCloud confirmed ownership of ${domain}.`,
          "You can now manage its hostnames and connection settings in AfuCloud.",
        ],
        action: { label: "Manage domains", url: `${SITE_URL}/domains` },
      };
    case "domain_registered":
      return {
        subject: `${cleanText(payload.domain, "Your domain", 180)} is registered`,
        preheader: "Your domain registration is complete.",
        title: "Domain registration complete",
        paragraphs: [
          `${domain} is now registered through AfuCloud.`,
          expiryLine || "Open AfuCloud to review the domain registration details.",
        ],
        action: { label: "View domain details", url: `${SITE_URL}/domains` },
      };
    case "domain_registration_review":
      return {
        subject: `Update on ${cleanText(payload.domain, "your domain order", 180)}`,
        preheader: "AfuCloud is reviewing your domain registration.",
        title: "Your order needs review",
        paragraphs: [
          `AfuCloud needs more time to confirm the registration of ${domain}.`,
          "Please do not submit another order. We will email you when the status changes.",
        ],
        action: { label: "View order status", url: `${SITE_URL}/domains` },
      };
    case "domain_registration_refunded":
      return {
        subject: `Refund confirmed for ${cleanText(payload.domain, "your domain order", 180)}`,
        preheader: "AfuCloud could not complete the domain registration.",
        title: "Your order was refunded",
        paragraphs: [
          `AfuCloud could not complete the registration of ${domain}.`,
          "The payment was refunded to its original payment method. The time it takes to appear can vary by bank.",
        ],
        action: { label: "Review domain orders", url: `${SITE_URL}/domains` },
      };
    case "domain_expiry_reminder": {
      const duration = days === 1 ? "one day" : `${Math.max(1, days)} days`;
      return {
        subject: `${cleanText(payload.domain, "Your domain", 180)} expires in ${duration}`,
        preheader: "Review your domain registration before it expires.",
        title: "Domain expiration reminder",
        paragraphs: [
          `${domain} is scheduled to expire in ${duration}${expires ? `, on ${escapeHtml(expires)}` : ""}.`,
          "AfuCloud renewal checkout is not available yet. Open your domain details to review the registration and next steps.",
        ],
        action: { label: "Review domain details", url: `${SITE_URL}/domains` },
      };
    }
    case "domain_expired":
      return {
        subject: `${cleanText(payload.domain, "Your domain")} has reached its expiration date`,
        preheader: "Your domain registration has reached its expiration date.",
        title: "Domain expiration date reached",
        paragraphs: [
          `${domain} has reached its registration expiration date${expires ? ` (${escapeHtml(expires)})` : ""}.`,
          "AfuCloud renewal checkout is not available yet. Open AfuCloud to review the domain status and next steps.",
        ],
        action: { label: "Review domain status", url: `${SITE_URL}/domains` },
      };
  }
}

export function renderTransactionalEmail(
  template: EmailTemplateKey,
  payload: Record<string, unknown> | null,
  recipientName: string | null,
): RenderedEmail {
  const copy = emailCopy(template, payload ?? {}, recipientName);
  const paragraphsHtml = copy.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#536158;">${paragraph}</p>`)
    .join("");
  const paragraphsText = copy.paragraphs.join("\n\n");
  const safeActionUrl = escapeHtml(copy.action.url);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f5f7f6;font-family:Arial,Helvetica,sans-serif;color:#16211b;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(copy.preheader)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5ebe7;border-radius:14px;">
      <tr><td style="padding:28px 32px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="padding-right:12px;vertical-align:middle;"><img src="${LOGO_URL}" width="44" height="44" alt="AfuCloud" style="display:block;border:0;width:44px;height:44px;"></td>
          <td style="vertical-align:middle;font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.4px;color:#07965B;">AfuCloud</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:12px 32px 32px;">
        <h1 style="margin:0 0 18px;font-size:24px;line-height:32px;color:#16211b;">${copy.title}</h1>
        ${paragraphsHtml}
        <p style="margin:24px 0 0;">
          <a href="${safeActionUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#07965B;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;">${escapeHtml(copy.action.label)}</a>
        </p>
        <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #edf1ee;font-size:12px;line-height:19px;color:#7b877f;">You received this message because you have an AfuCloud account or domain.</p>
      </td></tr>
    </table>
    <p style="max-width:560px;margin:18px auto 0;text-align:center;font-size:12px;line-height:18px;color:#89938d;">AfuCloud · Image delivery for developers</p>
  </body>
</html>`;
  const text = [
    "AfuCloud",
    "",
    decodeHtmlText(copy.title.replace(/<[^>]*>/g, "")),
    "",
    paragraphsText,
    "",
    `${copy.action.label}: ${copy.action.url}`,
    "",
    "AfuCloud · Image delivery for developers",
  ].join("\n");
  return { subject: copy.subject, html, text };
}

export async function sendTransactionalEmail(env: Env, message: EmailOutboxMessage): Promise<Response> {
  if (!env.RESEND_API_KEY) throw new Error("Transactional email is not configured.");
  const rendered = renderTransactionalEmail(
    message.template_key,
    message.payload,
    message.recipient_name,
  );
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.event_key,
      "User-Agent": "AfuCloud Worker",
    },
    body: JSON.stringify({
      from: FROM,
      to: [message.recipient_email],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });
}
