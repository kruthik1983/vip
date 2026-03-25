const nodemailer = require("nodemailer");

async function main() {
    const to = process.argv[2] || "kruthik934@gmail.com";

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || "0");
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || "verification@vip-platform.com";

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        console.error("Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in environment.");
        process.exit(1);
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    const info = await transporter.sendMail({
        from: smtpFrom,
        to,
        subject: "VIP Test Email",
        html: [
            "<h2>VIP Test Email</h2>",
            "<p>This is a direct SMTP test from your VIP project.</p>",
            "<p>If this appears in your inbox, email delivery is working.</p>",
        ].join(""),
    });

    console.log("Email queued successfully.");
    console.log("SMTP Host:", smtpHost);
    console.log("From:", smtpFrom);
    console.log("Recipient:", to);
    console.log("Message ID:", info.messageId || "N/A");
    console.log("SMTP Response:", info.response || "N/A");
    console.log("Accepted:", Array.isArray(info.accepted) ? info.accepted.join(", ") : "N/A");
    console.log("Rejected:", Array.isArray(info.rejected) ? info.rejected.join(", ") : "N/A");
    console.log("Envelope:", info.envelope ? JSON.stringify(info.envelope) : "N/A");
}

main().catch((error) => {
    console.error("Test email failed:", error?.message || error);
    process.exit(1);
});
