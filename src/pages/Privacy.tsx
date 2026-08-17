import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Footer } from "@/components/Footer";

const Privacy = () => {
  return (
    <AppShell>
      <div className="mb-6">
        <PageCorner />
      </div>
      <article className="prose prose-sm sm:prose max-w-none">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: May 29, 2026</p>

        <p>
          We respect your privacy. This page explains what we collect, why, and who
          we share it with. Plain English, no dark patterns.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account info:</strong> email, display name, optional profile
            data you provide.
          </li>
          <li>
            <strong>Learning data:</strong> your dialect preference, CEFR level,
            saved words, flashcard reviews, lesson progress, streak data.
          </li>
          <li>
            <strong>Content you create:</strong> audio you upload for transcription,
            transcripts you save, memes you analyze, social posts you import.
          </li>
          <li>
            <strong>Usage data:</strong> which pages and features you use, so we
            can improve them. We don't sell or share this with advertisers.
          </li>
          <li>
            <strong>Payment data:</strong> handled by Stripe. We never see your
            full card number.
          </li>
        </ul>

        <h2>Why we collect it</h2>
        <ul>
          <li>To run the app — show your progress, schedule reviews, save lessons.</li>
          <li>To bill paid plans and prevent abuse of free tiers.</li>
          <li>To improve the product based on what works and what doesn't.</li>
          <li>To send you important account or service emails.</li>
        </ul>

        <h2>Subprocessors we share data with</h2>
        <p>
          To run the service, your data is processed by these vendors. Each is bound
          by their own privacy terms.
        </p>
        <ul>
          <li><strong>Supabase</strong> — database, authentication, storage</li>
          <li><strong>Stripe</strong> — payments and subscriptions</li>
          <li><strong>Google (Gemini), OpenAI, Anthropic</strong> via the Lovable AI gateway — translations, explanations, image generation</li>
          <li><strong>ElevenLabs, Microsoft Azure Speech, Munsit</strong> — text-to-speech and speech-to-text</li>
          <li><strong>Bright Data, Firecrawl</strong> — fetching publicly available articles and posts you ask us to import</li>
        </ul>

        <h2>AI processing of your content</h2>
        <p>
          When you upload audio for transcription, paste a social post, or chat with
          the conversation simulator, that content is sent to one or more AI
          providers listed above. We don't use your content to train our own models,
          and our providers have agreed not to train on data from API calls.
        </p>

        <h2>Cookies and tracking</h2>
        <p>
          We use only the cookies needed to keep you signed in and remember your
          settings. No advertising trackers.
        </p>

        <h2>Your rights</h2>
        <p>You can at any time:</p>
        <ul>
          <li>Export your data by emailing us.</li>
          <li>Delete your account and all associated data.</li>
          <li>Ask what data we hold about you.</li>
        </ul>
        <p>
          Email <a href="mailto:hello@ingleezy.app">hello@ingleezy.app</a> for
          any of the above. We'll respond within 30 days.
        </p>

        <h2>Data retention</h2>
        <p>
          We keep your account and learning data until you delete your account.
          Transcriptions, uploaded audio and generated images are retained while
          they're useful for your account, and deleted on request.
        </p>

        <h2>Children</h2>
        <p>
          Ingleezy is not directed at children under 13. If you believe a child has
          created an account, email us and we'll remove it.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy. We'll notify you in the app or by email about
          material changes.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions: <a href="mailto:hello@ingleezy.app">hello@ingleezy.app</a>.
        </p>
      </article>
      <Footer />
    </AppShell>
  );
};

export default Privacy;
