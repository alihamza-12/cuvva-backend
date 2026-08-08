const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// 1. Configure the Gmail transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 2. The main email sending function
const sendPolicyEmail = async (userEmail, policyData) => {
  try {
    // Path to our static PDFs folder at the root level
    const pdfDir = path.join(__dirname, "..", "pdfs");

    // 3. Read the static PDF files into memory
    const attachments = [
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
    ];

    // 4. The Exact HTML UI (Normal Light Mode)
    const htmlTemplate = `
      <div style="background-color:#f4f4f5; margin:0; padding:20px 0; width:100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color:#ffffff; color:#151517; border-collapse: collapse; border-radius:12px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          
          <!-- Header Section -->
          <tr>
            <td style="padding: 30px 24px 10px 24px;">
              <h2 style="color:#151517; margin:0; font-size:24px; font-weight:800;">Cuvva</h2>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 16px 24px 40px 24px;">
              
              <p style="margin:0 0 16px 0; font-size:16px; line-height:1.5; color:#151517;">Hi ${policyData.customerFirstName},</p>
              <p style="margin:0 0 30px 0; font-size:16px; line-height:1.5; color:#6b6b70;">Your policy documents are in this email and in the app.</p>
              
              <!-- Policy Details Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f9f9f9; border-radius:12px; border:1px solid #e4e4e7;">
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 5px 0; font-size:18px; font-weight:700; color:#151517;">${policyData.vehicleMake} ${policyData.vehicleModel} · ${policyData.registration}</p>
                    <p style="margin:0 0 20px 0; font-size:14px; color:#6b6b70;">${policyData.startDateStr} - ${policyData.endDateStr}</p>
                    
                    <!-- Divider -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e4e4e7; margin-bottom:16px;">
                      <tr><td style="height:1px; font-size:0; line-height:0;">&nbsp;</td></tr>
                    </table>

                    <p style="margin:0 0 10px 0; font-size:14px; color:#6b6b70;">Policyholder: <span style="color:#151517; font-weight:600;">${policyData.customerFullName}</span></p>
                    <p style="margin:0 0 10px 0; font-size:14px; color:#6b6b70;">Total duration: <span style="color:#151517; font-weight:600;">${policyData.duration}</span></p>
                    <p style="margin:0 0 10px 0; font-size:14px; color:#6b6b70;">Total cost: <span style="color:#151517; font-weight:600;">£${policyData.price}</span></p>
                    <p style="margin:0 0 10px 0; font-size:14px; color:#6b6b70;">Payment: <span style="color:#151517; font-weight:600;">${policyData.cardBrand} ending ${policyData.cardLast4}</span></p>
                    <p style="margin:0 0 10px 0; font-size:14px; color:#6b6b70;">Insured by: <span style="color:#151517; font-weight:600;">Wakam</span></p>
                    <p style="margin:0 0 0px 0; font-size:14px; color:#6b6b70;">Policy reference: <span style="color:#151517; font-weight:600;">${policyData.policyNumber}</span></p>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 30px 0; font-size:14px; line-height:1.5; color:#6b6b70;"><span style="color:#151517; font-weight:700;">Action required:</span> Please make sure you take photos of ${policyData.registration} before your policy starts.</p>
              
              <!-- Report an Incident Button -->
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#6337d9; border-radius:8px; text-align:center;">
                    <a href="https://your-frontend-url.com/customer/policies/claim" style="display:inline-block; padding:14px 28px; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px;">Report an incident</a>
                  </td>
                </tr>
              </table>

              <p style="margin:40px 0 0 0; font-size:16px; color:#151517; font-weight:500;">Team Cuvva</p>
            </td>
          </tr>

          <!-- Footer Section -->
          <tr>
            <td style="padding: 0 24px 40px 24px; border-top:1px solid #f0f0f0;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding: 24px 0; font-size: 14px; color: #6b6b70; line-height: 1.6;">
                    <p style="margin:0 0 16px 0;"><strong style="color:#151517;">Any questions?</strong> The best way is via chat in the app. You can also email us at <a href="mailto:support@cuvva.com" style="color:#6337d9; text-decoration:underline;">support@cuvva.com</a>.</p>
                    
                    <p style="margin:0 0 24px 0; font-size:12px; line-height:1.5; color:#8a8a8f;">Cuvva Limited is a company registered in England and Wales with company number 08907985. Registered address: 4th Floor, Old Sessions House, 23 Clerkenwell Green, London, EC1R 0NA.</p>
                    
                    <!-- Social Links -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="font-size:13px; padding-bottom:20px;">
                          <a href="#" style="color:#6b6b70; text-decoration:none; margin-right:15px; font-weight:600;">LinkedIn</a>
                          <a href="#" style="color:#6b6b70; text-decoration:none; margin-right:15px; font-weight:600;">Twitter</a>
                          <a href="#" style="color:#6b6b70; text-decoration:none; margin-right:15px; font-weight:600;">Instagram</a>
                          <a href="#" style="color:#6b6b70; text-decoration:none; font-weight:600;">Facebook</a>
                        </td>
                      </tr>
                    </table>

                    <!-- App Store Buttons -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <a href="https://apps.apple.com/gb/app/cuvva/id1037464254" style="display:inline-block; background-color:#151517; color:#ffffff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:600; margin-right:10px;">🍎 App Store</a>
                          <a href="https://play.google.com/store/apps/details?id=com.cuvva.app" style="display:inline-block; background-color:#151517; color:#ffffff; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:600;">▶ Google Play</a>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </div>
    `;

    // 5. Send the email
    const info = await transporter.sendMail({
      from: `"Cuvva" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `Your Cuvva policy (${policyData.policyNumber})`,
      html: htmlTemplate,
      attachments: attachments, // Attach the 3 static PDFs
    });

    console.log("✅ Policy email sent successfully: " + info.messageId);
  } catch (error) {
    console.error("❌ Error sending policy email:", error);
  }
};

module.exports = { sendPolicyEmail };