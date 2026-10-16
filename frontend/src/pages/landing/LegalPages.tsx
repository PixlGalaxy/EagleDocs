import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../../components/layout/PublicLayout';
import { SUPPORT_EMAIL } from '../../components/brand';

// Legal copy is kept verbatim (English) from the previous site. Changing it
// is the owner's call, so the redesign only restyles it.

interface LegalSection {
  title: string;
  body: ReactNode;
}

const Mail = () => (
  <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
    {SUPPORT_EMAIL}
  </a>
);

function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <PublicLayout title={title}>
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h1>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{updated}</p>
        <div className="mt-12 space-y-10">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{s.title}</h2>
              <div className="mt-3 space-y-3 leading-relaxed text-slate-700 dark:text-slate-300 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{s.body}</div>
            </section>
          ))}
        </div>
      </article>
    </PublicLayout>
  );
}

export const PrivacyPolicy = () => (
  <LegalPage
    title="Privacy Policy"
    updated="Last updated: February 2025"
    sections={[
      { title: '1. Introduction', body: <p>StudyHawk values your privacy. This Privacy Policy explains what information we collect, how we use it, and the steps we take to protect it.</p> },
      {
        title: '2. What Data We Collect',
        body: (
          <>
            <p>When you use StudyHawk, we may collect the following types of information:</p>
            <ul>
              <li>
                <strong>Personal Information:</strong> Name, email address.
              </li>
              <li>
                <strong>Usage Data:</strong> Pages visited, interactions with AI, and system logs.
              </li>
              <li>
                <strong>Cookies:</strong> Small data files stored on your device for better user experience.
              </li>
            </ul>
          </>
        ),
      },
      {
        title: '3. How We Use Your Data',
        body: (
          <>
            <p>StudyHawk uses collected data to:</p>
            <ul>
              <li>Improve AI-generated responses.</li>
              <li>Analyze website usage for enhancements.</li>
              <li>Provide customer support and respond to inquiries.</li>
              <li>Ensure security and prevent misuse.</li>
            </ul>
          </>
        ),
      },
      { title: '4. Data Protection', body: <p>We implement security measures to protect your data, including encryption and secure servers. However, no method of data transmission is 100% secure.</p> },
      { title: '5. Third-Party Services', body: <p>StudyHawk may use third-party services (e.g., analytics, hosting). These services have their own privacy policies, which we encourage you to review.</p> },
      {
        title: '6. Your Rights',
        body: (
          <>
            <p>You have the right to:</p>
            <ul>
              <li>Request access to your personal data.</li>
              <li>Request deletion or correction of your data.</li>
              <li>Opt-out of non-essential data collection.</li>
            </ul>
            <p>
              To exercise these rights, contact us at <Mail />.
            </p>
          </>
        ),
      },
      { title: '7. Cookie Policy', body: <p>We use cookies to enhance your experience. You can disable cookies in your browser settings, but some features may not function properly.</p> },
      { title: '8. Changes to This Policy', body: <p>We may update this Privacy Policy periodically. Continued use of StudyHawk after updates constitutes acceptance of the revised policy.</p> },
      {
        title: '9. Contact Information',
        body: (
          <p>
            If you have any questions about this Privacy Policy, contact us at <Mail />.
          </p>
        ),
      },
    ]}
  />
);

export const TermsOfService = () => (
  <LegalPage
    title="Terms of Service"
    updated="Last updated: February 2025"
    sections={[
      { title: '1. Acceptance of Terms', body: <p>By accessing or using StudyHawk, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use the platform.</p> },
      {
        title: '2. AI Limitations & Accuracy',
        body: (
          <>
            <p>
              StudyHawk utilizes artificial intelligence to generate responses and educational content. While we strive to provide accurate and helpful information, the AI may generate incorrect, misleading, or outdated answers. Users should independently verify any critical information before relying on it.
            </p>
            <p>
              StudyHawk and its developers are not responsible for any consequences resulting from the use of AI-generated content. This includes, but is not limited to, misinformation, misinterpretations, or actions taken based on AI-provided guidance.
            </p>
          </>
        ),
      },
      {
        title: '3. Limitation of Liability',
        body: (
          <>
            <p>
              StudyHawk, its creators, and affiliates are not liable for any direct, indirect, incidental, or consequential damages arising from the use or inability to use the platform. Users assume full responsibility for their use of StudyHawk and any decisions made based on its content.
            </p>
            <p>The platform is provided "as is" without any warranties, express or implied, including but not limited to warranties of merchantability or fitness for a particular purpose.</p>
          </>
        ),
      },
      {
        title: '4. User Responsibilities',
        body: (
          <>
            <p>Users agree not to misuse StudyHawk for illegal, unethical, or harmful activities. This includes attempting to exploit, manipulate, or bypass the AI for unintended purposes.</p>
            <p>StudyHawk reserves the right to suspend or terminate access to users who violate these terms.</p>
          </>
        ),
      },
      {
        title: '5. Privacy Policy',
        body: (
          <p>
            StudyHawk collects and processes user data in accordance with its{' '}
            <Link to="/privacy" className="font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]">
              Privacy Policy
            </Link>
            . By using the platform, you consent to this data processing.
          </p>
        ),
      },
      { title: '6. Changes to These Terms', body: <p>StudyHawk reserves the right to update these Terms of Service at any time. Continued use of the platform after changes are made constitutes acceptance of the revised terms.</p> },
      {
        title: '7. Contact Information',
        body: (
          <p>
            If you have any questions regarding these Terms of Service, please contact us at <Mail />.
          </p>
        ),
      },
    ]}
  />
);
