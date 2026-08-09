const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// ────────────────────────────────────────────────────────────────────────
// 1. Transporter
// ────────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ────────────────────────────────────────────────────────────────────────
// 2. Official Cuvva links (verified against cuvva.com footer, Aug 2026)
//    Swap these for YOUR app's own links once you have real store listings.
// ────────────────────────────────────────────────────────────────────────
const LINKS = {
  support: "mailto:support@cuvva.com",
  appStore: "https://cuvvaapp.onelink.me/6DCd/jve0ulrz",
  googlePlay: "https://cuvvaplayapp.onelink.me/bs8e/wdk1o6db",
  facebook: "https://www.facebook.com/getcuvva/",
  x: "https://twitter.com/cuvva",
  instagram: "https://www.instagram.com/getcuvva/",
  tiktok: "https://www.tiktok.com/@cuvva",
  linkedin: "https://www.linkedin.com/company/cuvva",
  youtube: "https://www.youtube.com/channel/UCsZp91HBPsRlKyIitgZbVEA",
  registeredOffice: "https://maps.google.com/?q=4th+Floor+Old+Sessions+House+23+Clerkenwell+Green+London+EC1R+0NA",
};

// ────────────────────────────────────────────────────────────────────────
// 3. Build & send the email
// ────────────────────────────────────────────────────────────────────────
const sendPolicyEmail = async (userEmail, policyData) => {
  try {
    const pdfDir = path.join(__dirname, "..", "pdfs");
    const imgDir = path.join(__dirname, "..", "public", "email-assets");

    const attachments = [
      // PDFs
      {
        filename: "Policy details and certificate.pdf",
        content: fs.readFileSync(path.join(pdfDir, "Policy details and certificate.pdf")),
        contentType: "application/pdf",
      },
      {
        filename: "Policy wording (full terms).pdf",
        content: fs.readFileSync(path.join(pdfDir, "Policy wording (full terms).pdf")),
        contentType: "application/pdf",
      },
      {
        filename: "Insurance summary (IPID).pdf",
        content: fs.readFileSync(path.join(pdfDir, "Insurance summary (IPID).pdf")),
        contentType: "application/pdf",
      },
      // Embedded images (referenced via cid: in the HTML below)
      { filename: "cuvva-logo.png", path: path.join(imgDir, "cuvva-logo.png"), cid: "cuvvaLogo" },
      { filename: "app-store-badge.png", path: path.join(imgDir, "app-store-badge.png"), cid: "appStoreBadge" },
      { filename: "google-play-badge.png", path: path.join(imgDir, "google-play-badge.png"), cid: "googlePlayBadge" },
      { filename: "icon-x.png", path: path.join(imgDir, "icon-x.png"), cid: "iconX" },
      { filename: "icon-facebook.png", path: path.join(imgDir, "icon-facebook.png"), cid: "iconFacebook" },
      { filename: "icon-instagram.png", path: path.join(imgDir, "icon-instagram.png"), cid: "iconInstagram" },
      { filename: "icon-tiktok.png", path: path.join(imgDir, "icon-tiktok.png"), cid: "iconTiktok" },
      { filename: "icon-linkedin.png", path: path.join(imgDir, "icon-linkedin.png"), cid: "iconLinkedin" },
      { filename: "icon-youtube.png", path: path.join(imgDir, "icon-youtube.png"), cid: "iconYoutube" },
      { filename: "icon-mastercard.png", path: path.join(imgDir, "icon-mastercard.png"), cid: "iconMastercard" },
    ];

    const html = buildPolicyEmailHtml(policyData);

    const info = await transporter.sendMail({
      from: `"Cuvva" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `Your Cuvva policy (${policyData.policyNumber})`,
      html,
      attachments,
    });

    console.log("✅ Policy email sent: " + info.messageId);
    return info;
  } catch (error) {
    console.error("❌ Error sending policy email:", error);
    throw error;
  }
};

// ────────────────────────────────────────────────────────────────────────
// 4. HTML builder — laid out to match the forwarded Cuvva screenshots
//    (plain label/value rows, thin dividers, text links — not buttons)
// ────────────────────────────────────────────────────────────────────────
function buildPolicyEmailHtml(p) {
  // small helper for a "label ... value" row
  const row = (label, value, bold = false) => `
    <tr>
      <td style="padding:0 0 10px 0; font-size:15px; line-height:1.5; color:#151517; font-weight:${bold ? "700" : "400"};" align="left">${label}</td>
      <td style="padding:0 0 10px 0; font-size:15px; line-height:1.5; color:#151517; font-weight:${bold ? "700" : "400"};" align="right">${value}</td>
    </tr>`;

  const divider = `
    <tr>
      <td colspan="2" style="padding:8px 0 20px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-top:1px solid #e5e5e8; font-size:0; line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>`;

  const socialIcon = (cid, alt, href) => `
    <td style="padding:0 18px 0 0;">
      <a href="${href}" style="text-decoration:none;">
        <img src="cid:${cid}" width="24" height="24" alt="${alt}" style="display:block; border:0; outline:none;" />
      </a>
    </td>`;

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<!-- Force light rendering so glyph-style icons never get auto-inverted by a client's dark mode -->
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>Your Cuvva policy</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body, table, td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:#1a73e8; }
  /* Belt-and-braces: pin key colours so Gmail/Outlook dark-mode CSS injection can't flip them */
  @media (prefers-color-scheme: dark) {
    .force-bg   { background-color:#ffffff !important; }
    .force-text { color:#151517 !important; }
    .force-muted{ color:#5f6368 !important; }
  }
  [data-ogsc] .force-bg   { background-color:#ffffff !important; }
  [data-ogsc] .force-text { color:#151517 !important; }
</style>
</head>
<body class="force-bg" style="margin:0; padding:0; background-color:#f4f4f5;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
    Your Cuvva policy ${p.policyNumber} — ${p.vehicleMake} ${p.vehicleModel} · ${p.registration}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f5" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" class="force-bg" style="width:600px; max-width:100%; background-color:#ffffff; border-radius:8px;">

          <!-- Logo -->
          <tr>
            <td style="padding:36px 40px 24px 40px;">
              <img src="cid:cuvvaLogo" width="110" alt="Cuvva" style="display:block; height:auto; border:0;" />
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td class="force-text" style="padding:0 40px 20px 40px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#151517;">
              Hi ${p.customerFirstName},
            </td>
          </tr>
          <tr>
            <td class="force-text" style="padding:0 40px 20px 40px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#151517;">
              Thanks for choosing Cuvva.
            </td>
          </tr>
          <tr>
            <td class="force-text" style="padding:0 40px 24px 40px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#151517;">
              We've attached your policy documents to this email. You'll also find them in the app. If something doesn't look right, chat to us in the app or <a href="${LINKS.support}" style="color:#1a73e8; text-decoration:underline;">send us an email</a>.
            </td>
          </tr>

          <!-- Policy summary block -->
          <tr>
            <td style="padding:0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 20px 0; font-size:17px; font-weight:700; color:#151517;">
                    ${p.vehicleMake} ${p.vehicleModel} &middot; ${p.registration}
                  </td>
                </tr>

                ${row("Start", p.startDateStr)}
                ${row("End", p.endDateStr)}
                ${row("Policyholder", p.customerFullName)}
                ${row("Total duration", p.duration, true)}

                ${divider}

                ${row("Total cost", `&pound;${p.price}`, true)}

                <tr>
                  <td colspan="2" style="padding:4px 0 20px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:8px;">
                          <img src="cid:iconMastercard" width="22" height="22" alt="${p.cardBrand}" style="display:block; border:0;" />
                        </td>
                        <td class="force-muted" style="font-size:14px; color:#5f6368;">
                          Paid with ${p.cardBrand} ending ${p.cardLast4}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                ${divider}

                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 24px 0; font-size:15px; line-height:1.6; color:#151517;">
                    Your policy underwriter is ${p.underwriter || "Wakam"} and your policy reference number is ${p.policyNumber}.
                  </td>
                </tr>

                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 12px 0; font-size:16px; font-weight:700; color:#151517;">
                    You need to take a photo of ${p.registration} before your policy starts
                  </td>
                </tr>
                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 28px 0; font-size:15px; line-height:1.6; color:#151517;">
                    Before you set off, don't forget to open the Cuvva app and take a photo of the car. That way, we've got a visual record in case you need to make a claim later on. We'll send you a reminder nearer the time ⏰
                  </td>
                </tr>

                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 12px 0; font-size:16px; font-weight:700; color:#151517;">
                    How to report an accident, theft or vehicle damage
                  </td>
                </tr>
                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 16px 0; font-size:15px; line-height:1.6; color:#151517;">
                    If you're involved in any sort of incident or something happens to your vehicle, you need to let us know as soon as you can, even if it wasn't your fault.
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:0 0 28px 0; font-size:15px;">
                    <a href="${p.reportIncidentUrl || "https://www.cuvva.com/report-incident"}" style="color:#1a73e8; text-decoration:underline;">Report an incident</a>
                  </td>
                </tr>

                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 4px 0; font-size:15px; color:#151517;">Thanks,</td>
                </tr>
                <tr>
                  <td colspan="2" class="force-text" style="padding:0 0 32px 0; font-size:15px; color:#151517;">Team Cuvva 👋</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 40px 40px 40px; border-top:1px solid #f0f0f0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="force-text" style="padding:24px 0 8px 0; font-size:16px; font-weight:700; color:#151517;">
                    Any questions?
                  </td>
                </tr>
                <tr>
                  <td class="force-text" style="padding:0 0 32px 0; font-size:14px; line-height:1.6; color:#151517;">
                    If you have any questions or need any support, chat to us in app, email us at
                    <a href="${LINKS.support}" style="color:#1a73e8; text-decoration:underline;">support@cuvva.com</a>
                    or reply to this message.
                  </td>
                </tr>

                <!-- Social icons -->
                <tr>
                  <td style="padding:0 0 32px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        ${socialIcon("iconX", "X", LINKS.x)}
                        ${socialIcon("iconFacebook", "Facebook", LINKS.facebook)}
                        ${socialIcon("iconInstagram", "Instagram", LINKS.instagram)}
                        ${socialIcon("iconTiktok", "TikTok", LINKS.tiktok)}
                        ${socialIcon("iconLinkedin", "LinkedIn", LINKS.linkedin)}
                        <td style="padding:0;">
                          <a href="${LINKS.youtube}" style="text-decoration:none;">
                            <img src="cid:iconYoutube" width="24" height="24" alt="YouTube" style="display:block; border:0; outline:none;" />
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Legal -->
                <tr>
                  <td class="force-muted" style="padding:0 0 20px 0; font-size:12px; line-height:1.6; color:#5f6368;">
                    Cuvva Limited (Cuvva, we, our) is a company incorporated in England (no. 08907985) with registered office 4th Floor, Old Sessions House,
                    <a href="${LINKS.registeredOffice}" style="color:#1a73e8; text-decoration:underline;">23 Clerkenwell Green, London EC1R 0NA</a>.
                    We're authorised and regulated by the Financial Conduct Authority under number 690273. And we're registered with the Information Commissioner's Office under number ZA056769.
                  </td>
                </tr>

                <!-- App badges -->
                <tr>
                  <td style="padding:0;">
                    <a href="${LINKS.appStore}" style="display:block; text-decoration:none; margin-bottom:12px; width:135px;">
                      <img src="cid:appStoreBadge" width="135" alt="Download on the App Store" style="display:block; border:0; height:auto;" />
                    </a>
                    <a href="${LINKS.googlePlay}" style="display:block; text-decoration:none; width:135px;">
                      <img src="cid:googlePlayBadge" width="135" alt="Get it on Google Play" style="display:block; border:0; height:auto;" />
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { sendPolicyEmail, buildPolicyEmailHtml };
