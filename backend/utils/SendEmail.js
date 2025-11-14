import nodemailer from "nodemailer";

export async function sendVerificationEmail(email) {
    try {
        console.log("Preparing to send verification email to:", email);

        const transporter = nodemailer.createTransport({
            service: "Outlook",
            auth: {
                user: process.env.OUTLOOK_EMAIL,
                pass: process.env.OUTLOOK_PASSWORD
            }
        });

        const mailOptions = {
            from: process.env.OUTLOOK_EMAIL,
            to: email,
            subject: "Verify your EagleDocs account",
            text: "Thanks for signing up! Your EagleDocs account has been created."
        };

        const info = await transporter.sendMail(mailOptions);

        console.log("Verification email sent successfully:", info.response);

        return true;

    } catch (error) {
        console.error("❌ Error sending verification email:", error);
        return false;
    }
}

