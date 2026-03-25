import nodemailer from "nodemailer";

export interface EmailSendResult {
    sent: boolean;
    info?: string;
    reason?: string;
}

export async function sendOrganizationVerifiedEmail(params: {
    to: string;
    organizationName: string;
}): Promise<EmailSendResult> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM ?? "verification@vip-platform.com";

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        console.log(`[EMAIL-MOCK] Organization verified email to ${params.to} for ${params.organizationName}`);
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: Number(smtpPort) === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: "Your organization has been verified",
        html: `
      <h2>Organization Verified</h2>
      <p>Hello,</p>
      <p>Your organization <strong>${params.organizationName}</strong> has been verified successfully by our admin team.</p>
      <p>You can now continue with interview setup and hiring workflows in VIP.</p>
      <p>Regards,<br/>VIP Admin Team</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}

export async function sendOrganizationRejectedEmail(params: {
    to: string;
    organizationName: string;
    reason: string;
}): Promise<EmailSendResult> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM ?? "verification@vip-platform.com";

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        console.log(
            `[EMAIL-MOCK] Organization rejected email to ${params.to} for ${params.organizationName}. Reason: ${params.reason}`,
        );
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: Number(smtpPort) === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: "Organization verification update",
        html: `
      <h2>Organization Verification Update</h2>
      <p>Hello,</p>
      <p>Your organization <strong>${params.organizationName}</strong> could not be verified at this time.</p>
      <p><strong>Reason:</strong> ${params.reason}</p>
      <p>Please update your details and submit again.</p>
      <p>Regards,<br/>VIP Admin Team</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}
