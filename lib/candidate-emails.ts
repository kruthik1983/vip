import nodemailer from "nodemailer";

export interface EmailSendResult {
    sent: boolean;
    info?: string;
    reason?: string;
}

function getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM ?? "noreply@vip-platform.com";

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
        return null;
    }

    return nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: Number(smtpPort) === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });
}

const smtpFrom = process.env.SMTP_FROM ?? "noreply@vip-platform.com";

/**
 * Send assessment credentials email with one-time login token
 */
export async function sendAssessmentCredentialsEmail(params: {
    to: string;
    candidateName: string;
    assessmentStartTime: string;
    assessmentToken: string;
    interviewTitle: string;
}): Promise<EmailSendResult> {
    const transporter = getTransporter();

    if (!transporter) {
        console.log(
            `[EMAIL-MOCK] Assessment credentials email to ${params.to} for ${params.candidateName}. Token: ${params.assessmentToken.substring(0, 8)}...`
        );
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const assessmentLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://vip-platform.com"}/candidate/assessment?token=${params.assessmentToken}`;

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: `Your Assessment Access - ${params.interviewTitle}`,
        html: `
      <h2>Assessment Access Granted</h2>
      <p>Hello ${params.candidateName},</p>
      <p>Congratulations! You have been selected for the next stage of our interview process.</p>
      
      <h3>Assessment Details</h3>
      <ul>
        <li><strong>Interview:</strong> ${params.interviewTitle}</li>
        <li><strong>Start Time:</strong> ${params.assessmentStartTime}</li>
      </ul>

      <h3>Your One-Time Login Link</h3>
      <p>Use the link below to access your assessment. This link is unique to you and valid until the assessment start time.</p>
      <p>
        <a href="${assessmentLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Access Assessment
        </a>
      </p>
      <p><strong>Or copy this link:</strong> ${assessmentLink}</p>

      <h3>Tips</h3>
      <ul>
        <li>Ensure you have a stable internet connection</li>
        <li>Use a device with a camera and microphone if required</li>
        <li>Find a quiet location for the assessment</li>
        <li>Allow extra time for technical setup</li>
      </ul>

      <p>If you have any technical issues, please contact our support team.</p>
      <p>Regards,<br/>VIP Interview Platform</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}

/**
 * Send interview credentials email with one-time login token
 */
export async function sendInterviewCredentialsEmail(params: {
    to: string;
    candidateName: string;
    interviewStartTime: string;
    interviewToken: string;
    interviewTitle: string;
}): Promise<EmailSendResult> {
    const transporter = getTransporter();

    if (!transporter) {
        console.log(
            `[EMAIL-MOCK] Interview credentials email to ${params.to} for ${params.candidateName}. Token: ${params.interviewToken.substring(0, 8)}...`
        );
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const interviewLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://vip-platform.com"}/candidate/interview?token=${params.interviewToken}`;

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: `Your Interview Access - ${params.interviewTitle}`,
        html: `
      <h2>Interview Access Granted</h2>
      <p>Hello ${params.candidateName},</p>
      <p>Great news! You have advanced to the interview stage of our hiring process.</p>
      
      <h3>Interview Details</h3>
      <ul>
        <li><strong>Position:</strong> ${params.interviewTitle}</li>
        <li><strong>Interview Date & Time:</strong> ${params.interviewStartTime}</li>
      </ul>

      <h3>Your One-Time Login Link</h3>
      <p>Use the link below to join your interview. This link is unique to you and valid until the interview start time.</p>
      <p>
        <a href="${interviewLink}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Join Interview
        </a>
      </p>
      <p><strong>Or copy this link:</strong> ${interviewLink}</p>

      <h3>Interview Format</h3>
      <ul>
        <li>Duration: Approximately 45-60 minutes</li>
        <li>Format: Video interview with our panel</li>
        <li>What to Bring: Resume and any supporting documents</li>
        <li>Technical Requirements: Camera, microphone, and stable internet</li>
      </ul>

      <h3>Before Your Interview</h3>
      <ul>
        <li>Test your camera and microphone in advance</li>
        <li>Choose a professional background and quiet location</li>
        <li>Arrive 5 minutes early to ensure connectivity</li>
        <li>Have your resume ready to reference</li>
      </ul>

      <p>If you need to reschedule or have technical issues, please contact us as soon as possible.</p>
      <p>Regards,<br/>VIP Interview Platform</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}

/**
 * Send slot assignment confirmation email
 */
export async function sendSlotAssignmentEmail(params: {
    to: string;
    candidateName: string;
    assessmentStartTime: string;
    interviewStartTime: string;
    interviewTitle: string;
}): Promise<EmailSendResult> {
    const transporter = getTransporter();

    if (!transporter) {
        console.log(
            `[EMAIL-MOCK] Slot assignment email to ${params.to} for ${params.candidateName}`
        );
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: `Your Interview Slots Have Been Assigned - ${params.interviewTitle}`,
        html: `
      <h2>Slots Assigned</h2>
      <p>Hello ${params.candidateName},</p>
      <p>Thank you for applying! We're pleased to let you know that your interview slots have been assigned.</p>
      
      <h3>Your Schedule</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background-color: #f5f5f5;">
          <th style="padding: 12px; text-align: left; border: 1px solid #ddd;"><strong>Stage</strong></th>
          <th style="padding: 12px; text-align: left; border: 1px solid #ddd;"><strong>Date & Time (UTC)</strong></th>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;">Assessment</td>
          <td style="padding: 12px; border: 1px solid #ddd;">${params.assessmentStartTime}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;">Interview</td>
          <td style="padding: 12px; border: 1px solid #ddd;">${params.interviewStartTime}</td>
        </tr>
      </table>

      <h3>Next Steps</h3>
      <p>You will receive separate emails with access links for each stage shortly. Be sure to:</p>
      <ul>
        <li>Check your spam folder for our emails</li>
        <li>Arrive 5 minutes early for each session</li>
        <li>Test your technical setup in advance</li>
      </ul>

      <p>If you have any questions or need to reschedule, please let us know immediately.</p>
      <p>Good luck!</p>
      <p>Regards,<br/>VIP Interview Platform</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}

/**
 * Send 24-hour assessment reminder
 */
export async function sendAssessmentReminderEmail(params: {
    to: string;
    candidateName: string;
    assessmentStartTime: string;
    assessmentToken: string;
    interviewTitle: string;
}): Promise<EmailSendResult> {
    const transporter = getTransporter();

    if (!transporter) {
        console.log(
            `[EMAIL-MOCK] Assessment reminder email to ${params.to} for ${params.candidateName}`
        );
        return {
            sent: false,
            reason: "SMTP is not configured. Email logged in server console.",
        };
    }

    const assessmentLink = `${process.env.NEXT_PUBLIC_APP_URL || "https://vip-platform.com"}/candidate/assessment?token=${params.assessmentToken}`;

    const mail = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject: `Reminder: Your Assessment is Tomorrow - ${params.interviewTitle}`,
        html: `
      <h2>Assessment Reminder</h2>
      <p>Hello ${params.candidateName},</p>
      <p>This is a friendly reminder that your assessment is happening tomorrow!</p>
      
      <h3>Assessment Details</h3>
      <ul>
        <li><strong>Position:</strong> ${params.interviewTitle}</li>
        <li><strong>Scheduled Time:</strong> ${params.assessmentStartTime}</li>
      </ul>

      <h3>Quick Checklist</h3>
      <ul style="list-style-type: none; padding: 0;">
        <li>☑️ Test your camera and microphone</li>
        <li>☑️ Ensure stable internet connection</li>
        <li>☑️ Find a quiet location</li>
        <li>☑️ Arrive 5 minutes early</li>
      </ul>

      <h3>Access Your Assessment</h3>
      <p>
        <a href="${assessmentLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Start Assessment
        </a>
      </p>

      <p>If you're having any issues or need to reschedule, please reach out immediately.</p>
      <p>Good luck!<br/>VIP Interview Platform</p>
    `,
    });

    return {
        sent: true,
        info: mail.messageId,
    };
}
