import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Footer } from "@/components/Footer";

const Terms = () => {
  return (
    <AppShell>
      <div className="mb-6">
        <HomeButton />
      </div>
      <article className="prose prose-sm sm:prose max-w-none">
        <h1>Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated: May 29, 2026</p>

        <p>
          Welcome to Hakiya. By creating an account or using this site you agree to
          these terms. They're written in plain English on purpose.
        </p>

        <h2>What Hakiya is</h2>
        <p>
          Hakiya is an Arabic-learning web app focused on spoken dialects (Gulf,
          Egyptian, Yemeni). We provide lessons, flashcards, audio, AI-assisted
          practice, and tools to learn from real media (videos, social posts,
          transcriptions you upload).
        </p>

        <h2>Your account</h2>
        <ul>
          <li>You must be at least 13 years old to create an account.</li>
          <li>You're responsible for keeping your password safe.</li>
          <li>Don't share your account with others.</li>
          <li>One person, one account.</li>
        </ul>

        <h2>Acceptable use</h2>
        <p>Don't do any of the following:</p>
        <ul>
          <li>Upload copyrighted material you don't have the right to use.</li>
          <li>Upload anything illegal, hateful, harassing, or sexually explicit.</li>
          <li>Try to break, probe, or overload our systems.</li>
          <li>Resell or redistribute the content without permission.</li>
          <li>Use the AI features to generate harmful, deceptive, or illegal content.</li>
        </ul>
        <p>
          We may suspend or remove accounts that violate these rules, with no refund.
        </p>

        <h2>Free and paid plans</h2>
        <p>
          We offer a free tier with daily limits on AI-heavy features (transcription,
          image generation, conversation practice, etc.). Paid plans remove or raise
          those limits. Prices, limits and features can change with notice. If you
          cancel a paid plan you keep access until the end of the current billing
          period; we don't pro-rate refunds.
        </p>

        <h2>Your content</h2>
        <p>
          You keep ownership of audio, text, or media you upload. You grant Hakiya a
          limited license to store, process, and display that content so we can
          provide the service to you (e.g. transcribing audio, generating
          flashcards). We won't sell your content.
        </p>

        <h2>Contributing practice recordings (optional)</h2>
        <p>
          In Settings you can choose to contribute your pronunciation practice
          recordings. This is <strong>off by default</strong>. If you turn it on, we
          keep the audio clips you record during pronunciation practice, together
          with the phrase you were practising and the score you received, and we may
          use them to improve Arabic speech recognition and the learning features in
          Hakiya — including training or fine-tuning speech and language models.
        </p>
        <p>
          Contributed recordings are stored privately, are never published or shared
          as identifiable audio, and are kept separate from your name and email in
          our training data. You can turn contribution off at any time in Settings —
          new recordings stop being kept immediately. To have previously contributed
          recordings deleted, contact us and we will remove them.
        </p>

        <h2>AI-generated content</h2>
        <p>
          Hakiya uses AI models to generate translations, explanations, images, audio,
          and example sentences. AI output can be wrong. Don't rely on it for
          professional, legal, medical, or safety-critical decisions.
        </p>

        <h2>No warranty</h2>
        <p>
          The service is provided "as is". We don't guarantee uninterrupted access,
          perfect accuracy of any content, or fitness for any particular purpose.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent allowed by law, Hakiya's liability for any claim
          related to the service is limited to the amount you paid us in the 12
          months before the claim.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms. If a change is material we'll tell you in the
          app or by email. Continuing to use Hakiya after a change means you accept
          the new terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email <a href="mailto:hello@hakiya.app">hello@hakiya.app</a>.
        </p>
      </article>
      <Footer />
    </AppShell>
  );
};

export default Terms;
