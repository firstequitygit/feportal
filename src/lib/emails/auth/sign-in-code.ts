export type SignInCodeEmail = {
  /** The 6-digit code from adminClient.auth.admin.generateLink properties.email_otp */
  code: string
  /** The magic-link URL from adminClient.auth.admin.generateLink properties.action_link */
  magicLink: string
}

export function renderSignInCodeEmail({ code, magicLink }: SignInCodeEmail): { subject: string; html: string } {
  const subject = 'Your First Equity Funding sign-in code'
  const html = `
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">Hi,</p>
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
      Use the code below to sign in to your <strong>First Equity Funding Online Portal</strong> account.
    </p>
    <div style="margin: 24px 0; padding: 20px; background-color: #F4F7FB; border: 1px solid #DDE6EF; border-radius: 8px; text-align: center;">
      <div style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; color: #1F5D8F; letter-spacing: 8px;">
        ${code}
      </div>
    </div>
    <p style="font-family: Arial, sans-serif; font-size: 14px; color: #555;">
      Or click the button to sign in directly:
    </p>
    <p style="margin-top: 12px;">
      <a href="${magicLink}" style="background-color: #1F5D8F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: bold;">
        Sign in
      </a>
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999; margin-top: 24px;">
      This code and link expire in 10 minutes. If you didn't request this, you can safely ignore this email.
    </p>
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #999;">First Equity Funding Online Portal</p>
  `
  return { subject, html }
}
