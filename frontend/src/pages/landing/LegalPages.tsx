import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../../components/layout/PublicLayout';
import { SUPPORT_EMAIL } from '../../components/brand';

// Legal copy (English), approved by the owner. Keep it in step with what the
// app really does: data collected, providers, retention, plans.

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

const UPDATED = 'Last updated: October 16, 2026';

const link = 'font-medium text-[var(--accent-700)] hover:underline dark:text-[var(--accent-300)]';

export const PrivacyPolicy = () => (
  <LegalPage
    title="Privacy Policy"
    updated={UPDATED}
    sections={[
      {
        title: '1. Who we are',
        body: (
          <p>
            StudyHawk is an AI assistant for university students, created and operated by Fabrizio Gamboa (PixlGalaxy) ("we", "us"). This policy explains what information StudyHawk collects, why, who it is shared with, how long it is kept,
            and the choices you have.
          </p>
        ),
      },
      {
        title: '2. The short version',
        body: (
          <ul>
            <li>We collect only what StudyHawk needs to work for you, and only what you connect to it.</li>
            <li>
              <strong>We never use your chats, files, courses or any other data to train AI models</strong>, and we never sell your data.
            </li>
            <li>Passwords, tokens and keys you give us are encrypted, and the AI never sees them.</li>
            <li>You can download a copy of your data, or delete your account and everything in it, at any time from Settings.</li>
          </ul>
        ),
      },
      {
        title: '3. Information we collect',
        body: (
          <>
            <p>
              <strong>Account:</strong> your name, username, email address, password (stored only as a one-way hash), institution, major, language and time zone.
            </p>
            <p>
              <strong>What you create in StudyHawk:</strong> your chats with the assistant, the files you upload or that the assistant creates for you, the indexes it builds from your documents, its memory notes about you
              (which you can see and edit in Settings), your skills, scheduled tasks and preferences.
            </p>
            <p>
              <strong>Services you choose to connect:</strong>
            </p>
            <ul>
              <li>
                <strong>Canvas:</strong> with the access token you provide, we read your courses, assignments, due dates, grades, announcements, modules and files. StudyHawk only reads Canvas; it never submits or changes anything there.
              </li>
              <li>
                <strong>Your university account:</strong> if you connect it, we store your university username and password, encrypted, and use them to sign in on your behalf to read and, only when you approve each message, send email
                (for example Outlook), and to read your degree audit (for example Degree Works). Saved sign-in cookies are kept so you do not need to approve every sign-in.
              </li>
              <li>
                <strong>Your own AI accounts:</strong> API keys or a ChatGPT sign-in you add, stored encrypted.
              </li>
            </ul>
            <p>
              <strong>Payments:</strong> if you buy a plan, Stripe processes the payment. We receive your plan, subscription status and billing email; we never see or store your card number.
            </p>
            <p>
              <strong>Device and usage:</strong> notification subscriptions for the devices where you turn them on, your daily usage (for plan limits), and technical logs (IP address, browser, errors) used for security and to fix problems.
            </p>
          </>
        ),
      },
      {
        title: '4. How we use it',
        body: (
          <ul>
            <li>To provide StudyHawk: answer your questions, read your courses, manage your files and run the tasks you ask for.</li>
            <li>To send the emails and notifications you expect (account verification, password resets, finished tasks, approvals).</li>
            <li>To apply plan limits and process payments.</li>
            <li>To keep StudyHawk secure, prevent abuse and fix problems.</li>
            <li>To answer you when you contact us.</li>
          </ul>
        ),
      },
      {
        title: '5. Who we share it with',
        body: (
          <>
            <p>We share data only with the services needed to do what you ask:</p>
            <ul>
              <li>
                <strong>AI model providers:</strong> your messages and the content the assistant reads for you are sent to the AI model that answers. That may be StudyHawk's own servers or, if you choose one, a provider such as OpenAI,
                Anthropic or ChatGPT under your own account, which then handles it under its own policies.
              </li>
              <li>
                <strong>Your school's services</strong> (Canvas, email, degree audit), only when you connect them.
              </li>
              <li>
                <strong>Search engines and websites,</strong> when the assistant searches or browses the web for you.
              </li>
              <li>
                <strong>Stripe</strong> for payments, your email provider for StudyHawk's emails, and your browser's push service (Google, Apple, Mozilla or Microsoft) for notifications.
              </li>
              <li>
                <strong>Apps you authorize,</strong> such as ChatGPT or Claude connected to StudyHawk, only with the permissions you approve. You can revoke them in Settings.
              </li>
            </ul>
            <p>We may also disclose information when the law requires it, or to protect the rights and safety of our users and StudyHawk.</p>
          </>
        ),
      },
      {
        title: '6. Students and education records',
        body: (
          <p>
            Some of the information StudyHawk reads from your school, such as grades and degree audits, may be education records under FERPA. You choose to connect these services and you can disconnect them at any time. StudyHawk is not
            operated by or on behalf of your school unless your school tells you otherwise.
          </p>
        ),
      },
      {
        title: '7. How long we keep it',
        body: (
          <ul>
            <li>Your account, chats, files and memory: until you delete them or your account. When you delete your account, it is switched off at once and everything in it is erased 30 days later; signing in again before then keeps it.</li>
            <li>Files in your TEMP folder: deleted automatically 24 hours after their last change.</li>
            <li>Live progress of the assistant's tasks: deleted 24 hours after each task ends.</li>
            <li>Technical logs: 7 days. Sign-in sessions: until you sign out or they expire (7 days by default).</li>
            <li>Sign-ups that were never verified: deleted after 72 hours.</li>
          </ul>
        ),
      },
      {
        title: '8. Security',
        body: (
          <p>
            Data travels over HTTPS. Secrets are encrypted with AES-256-GCM; passwords are hashed with argon2. Code the assistant runs for you executes in an isolated container of your own. No system is perfectly secure, and we
            describe our safeguards and known open issues in our public SECURITY.md.
          </p>
        ),
      },
      {
        title: '9. Your choices and rights',
        body: (
          <>
            <ul>
              <li>See and edit your profile, memory notes, skills and scheduled tasks in Settings.</li>
              <li>Disconnect Canvas, your university account, your AI accounts or any authorized app at any time.</li>
              <li>Download or delete your files from the Files page.</li>
              <li>Download a copy of your data (your files and a file with your profile, chats, memory and settings) from Settings → Account.</li>
              <li>Delete your account and all its data from Settings → Account. It is erased 30 days later; signing in before then cancels the deletion. A paid plan is cancelled at once.</li>
            </ul>
            <p>
              For anything else, such as a correction, write to <Mail /> from your account's email address. We answer within 30 days.
            </p>
          </>
        ),
      },
      {
        title: '10. Cookies and local storage',
        body: (
          <p>
            StudyHawk uses one essential cookie to keep you signed in and one to protect forms against cross-site requests. Your browser also stores your theme, language and similar preferences. We do not use advertising or
            tracking cookies, and we do not use third-party analytics.
          </p>
        ),
      },
      {
        title: '11. Age',
        body: (
          <p>
            StudyHawk is for people 18 and older. Users from 13 to 17 may use it only with the permission of a parent or legal guardian. It is not meant for anyone under 13, and we delete accounts we learn belong to a child under 13.
          </p>
        ),
      },
      {
        title: '12. Changes to this policy',
        body: <p>When we change this policy we update the date above, and for important changes we tell you in the app or by email before they apply.</p>,
      },
      {
        title: '13. Contact',
        body: (
          <p>
            Questions about this policy or your data: <Mail />.
          </p>
        ),
      },
    ]}
  />
);

export const TermsOfService = () => (
  <LegalPage
    title="Terms of Service"
    updated={UPDATED}
    sections={[
      {
        title: '1. Agreement',
        body: (
          <p>
            These terms are an agreement between you and Fabrizio Gamboa (PixlGalaxy), who creates and operates StudyHawk ("we", "us"). By creating an account or using StudyHawk you accept them. If you do not agree, do not use
            StudyHawk.
          </p>
        ),
      },
      {
        title: '2. Who can use StudyHawk',
        body: (
          <p>
            You must be 18 or older, or between 13 and 17 with the permission of a parent or legal guardian who agrees to these terms for you. StudyHawk is not for anyone under 13. You are responsible for your account: keep your password
            safe and tell us at once if someone else uses it.
          </p>
        ),
      },
      {
        title: '3. AI can be wrong',
        body: (
          <>
            <p>
              StudyHawk's answers are generated by AI. They can be incorrect, incomplete or out of date, even when they come from your own courses. Always check due dates, grades, degree requirements and anything important in the
              original source (Canvas, your school, your instructor or advisor) before relying on it.
            </p>
            <p>StudyHawk is not academic, legal, financial or medical advice, and it does not replace your school's official systems or advisors.</p>
          </>
        ),
      },
      {
        title: '4. Academic integrity',
        body: (
          <p>
            StudyHawk is built to help you learn: to explain, organize, guide and give feedback. You are responsible for following your school's and your instructors' rules on the use of AI. Do not submit work produced by StudyHawk as
            your own where that is not allowed.
          </p>
        ),
      },
      {
        title: '5. Connected services and actions',
        body: (
          <>
            <p>
              When you connect Canvas, your university account or other services, you authorize StudyHawk to access them on your behalf as described in the{' '}
              <Link to="/privacy" className={link}>
                Privacy Policy
              </Link>
              . You confirm you have the right to do so. Some schools do not allow third-party tools to use student accounts; checking your school's rules is your responsibility, and you can disconnect at any time.
            </p>
            <p>
              Actions that affect other people or the outside world, such as sending an email or clicking on a website, are shown to you for approval first. You are responsible for the actions you approve, and for the tasks you schedule.
            </p>
          </>
        ),
      },
      {
        title: '6. Acceptable use',
        body: (
          <>
            <p>You agree not to:</p>
            <ul>
              <li>break the law, or harass, deceive or harm anyone;</li>
              <li>access accounts, data or systems you are not authorized to use;</li>
              <li>attack, overload, probe or bypass the security or limits of StudyHawk or of any connected service;</li>
              <li>use the code sandbox or browser for spam, scraping at scale, cryptocurrency mining or attacks on other systems;</li>
              <li>resell, share or automate access to your account, or use StudyHawk to build a competing product.</li>
            </ul>
            <p>We may limit, suspend or close accounts that break these terms, and remove content that does.</p>
          </>
        ),
      },
      {
        title: '7. Your content',
        body: (
          <p>
            You keep the rights to the files, messages and other content you put into StudyHawk. You give us permission to store, process and transmit it only to provide StudyHawk to you. We do not use it to train AI models.
          </p>
        ),
      },
      {
        title: '8. Plans and payments',
        body: (
          <ul>
            <li>Paid plans renew automatically each billing period until you cancel. Prices and limits are shown before you subscribe.</li>
            <li>You can cancel at any time from Settings. Your plan stays active until the end of the period you paid for, and you are not charged again.</li>
            <li>
              <strong>Payments are non-refundable</strong>, including for partly used periods, except where the law requires otherwise.
            </li>
            <li>If a payment fails, your plan may move to the free plan after a short grace period.</li>
            <li>We may change prices or plans; changes apply from your next billing period, and we tell you before they do.</li>
          </ul>
        ),
      },
      {
        title: '9. Ownership',
        body: (
          <p>
            StudyHawk, its software, design, name, logos (including the SH and ED marks) and the former name EagleDocs belong to Fabrizio Gamboa (PixlGalaxy). The source code is published under the StudyHawk Source-Available License,
            which does not allow commercial use, hosting for others or removing its branding. These terms give you the right to use the StudyHawk service, not to copy or reuse any of it.
          </p>
        ),
      },
      {
        title: '10. Availability',
        body: <p>We work to keep StudyHawk running, but it may be interrupted, changed or discontinued, and features may be added or removed. Keep your own copies of anything important.</p>,
      },
      {
        title: '11. No warranty and limitation of liability',
        body: (
          <>
            <p>STUDYHAWK IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT.</p>
            <p>
              TO THE FULLEST EXTENT ALLOWED BY LAW, WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL OR CONSEQUENTIAL DAMAGES, OR FOR LOST GRADES, DATA, OPPORTUNITIES OR PROFITS, ARISING FROM YOUR USE OF STUDYHAWK OR OF ITS
              ANSWERS. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM, OR 50 US DOLLARS IF YOU PAID NOTHING.
            </p>
          </>
        ),
      },
      {
        title: '12. Ending your use',
        body: (
          <p>
            You can stop using StudyHawk and delete your account at any time from Settings → Account. Your account is switched off at once and erased 30 days later, unless you sign in again before then; a paid plan is cancelled at once, without a refund. We may end these terms or your access if you break them. Sections 7, 9, 11 and 13 continue to apply afterwards.
          </p>
        ),
      },
      {
        title: '13. Governing law',
        body: <p>These terms are governed by the laws of the State of Florida, United States. Any dispute will be resolved in the state or federal courts located in Florida.</p>,
      },
      {
        title: '14. Changes to these terms',
        body: <p>When we change these terms we update the date above, and for important changes we tell you in the app or by email before they apply. Using StudyHawk after that means you accept the new terms.</p>,
      },
      {
        title: '15. Contact',
        body: (
          <p>
            Questions about these terms: <Mail />.
          </p>
        ),
      },
    ]}
  />
);
