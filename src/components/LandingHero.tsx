import { useNavigate } from "react-router-dom";
import { ArrowRight, Headphones, Brain, PlayCircle, Globe2 } from "lucide-react";
import { Button, CampfireMedallion } from "@/components/design-system";
import ingleezyLogoAsset from "@/assets/ingleezy-logo.png.asset.json";

const ingleezyLogo = ingleezyLogoAsset.url;

/**
 * Logged-out landing hero shown on `/` when the visitor isn't authenticated.
 * Goal: explain Ingleezy in one screen and push to /auth or /placement.
 *
 * The framing is the name. Ingleezy is حكاية — a story — so the page opens on
 * people telling one round a fire, and the three value cards run as a story
 * arc: who tells it, how it stays with you, what you get to hear next.
 *
 * The journey/caravan metaphor is not gone, just moved to where it earns its
 * keep: the placement quiz ("wherever you are in your journey") and the
 * Alphabet Journey's 28-stop caravan.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="py-6">
      {/* Logo */}
      <div className="flex justify-center mb-5">
        <img src={ingleezyLogo} alt="Ingleezy" className="h-16 sm:h-20" />
      </div>

      {/* The fire: campfire clip + its one-line beat */}
      <div className="flex flex-col items-center mb-6">
        <CampfireMedallion className="max-w-[360px] sm:max-w-[480px]" />
        <p className="mt-3 text-caption text-muted-foreground text-center">
          <span className="font-arabic" dir="rtl">
            حكاية
          </span>{" "}
          — a story. Yours starts with one word.
        </p>
      </div>

      {/* Hero copy */}
      <div className="text-center max-w-xl mx-auto mb-8">
        {/*
          The line breaks are deliberate: left to wrap on its own the headline
          splits after "one", and the dialect line strands "Yemeni." on a line
          of its own at 375px. The dialect names step down a size — they qualify
          the promise above rather than share its weight.
        */}
        <h1 className="text-t-headline sm:text-t-display text-desert-red mb-3 text-balance">
          Real spoken Arabic,
          <br />
          one story at a time.
          <span className="block mt-1 text-t-subtitle sm:text-t-title text-desert-red/70">
            Gulf · Egyptian · Yemeni.
          </span>
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          Ingleezy means{" "}
          <span className="font-arabic" dir="rtl">
            حكاية
          </span>{" "}
          — a story. Dialect-first lessons, native audio, and spaced-repetition
          flashcards built from the stories people actually tell.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-10">
        <Button
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/auth")}
        >
          Join the beta — it's free
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/placement")}
        >
          Try the placement quiz
        </Button>
      </div>

      {/* Value props — who tells the story, how it sticks, what you hear next */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto mb-6">
        <ValueCard
          icon={<Headphones className="h-5 w-5" />}
          title="Told by native voices"
          body="Every word and sentence recorded by native speakers from the Gulf, Egypt and Yemen — so what you learn is what you'll actually hear."
        />
        <ValueCard
          icon={<Brain className="h-5 w-5" />}
          title="Every story stays with you"
          body="Words come back exactly when you're about to forget them. Built on FSRS, the modern successor to SM-2."
        />
        <ValueCard
          icon={<PlayCircle className="h-5 w-5" />}
          title="Stories you'd actually watch"
          body="TikToks, news clips, stories and conversations — tap any word to learn and save it."
        />
      </div>

      {/* Secondary nudges */}
      <div className="text-center max-w-md mx-auto">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Globe2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            Coming from MSA? We bridge{" "}
            <span className="font-arabic" dir="rtl">
              فصحى
            </span>{" "}
            into spoken dialect for you.
          </span>
        </p>
      </div>
    </section>
  );
}

function ValueCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="p-4 rounded-2xl bg-card border border-desert-red/15">
      <div className="h-9 w-9 rounded-xl bg-desert-red/10 flex items-center justify-center text-desert-red mb-2.5">
        {icon}
      </div>
      <h3 className="font-semibold text-foreground text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
