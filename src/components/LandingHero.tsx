import { useNavigate } from "react-router-dom";
import { ArrowRight, Headphones, Brain, PlayCircle, Globe2 } from "lucide-react";
import { Button, CampfireMedallion } from "@/components/design-system";
import ingleezyLogoAsset from "@/assets/ingleezy-logo.png.asset.json";

const ingleezyLogo = ingleezyLogoAsset.url;

/**
 * Logged-out landing hero shown on `/` when the visitor isn't authenticated.
 * Goal: explain Ingleezy in one screen and push to /auth or /placement.
 *
 * The framing is the name. إنجليزي is what an Arabic speaker already calls the
 * language — not "English as a Foreign Language", just the thing everyone is
 * trying to speak. So the promise is spoken English rather than exam English,
 * and it is made in the visitor's own language: this page is Arabic end to
 * end, and the only Latin script on it is the product's own logo.
 *
 * The campfire stays. Inherited from Hakiya it meant "a story told round a
 * fire"; here it carries the same weight for the opposite direction — real
 * people talking, which is the English this app teaches.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="py-6">
      {/* Logo */}
      <div className="flex justify-center mb-5">
        <img src={ingleezyLogo} alt="إنجليزي" className="h-16 sm:h-20" />
      </div>

      {/* The fire: campfire clip + its one-line beat */}
      <div className="flex flex-col items-center mb-6">
        <CampfireMedallion className="max-w-[360px] sm:max-w-[480px]" />
        <p className="mt-3 text-caption text-muted-foreground text-center">
          إنجليزي — اللي الناس تتكلمه فعلاً. يبدأ بكلمة وحدة.
        </p>
      </div>

      {/* Hero copy */}
      <div className="text-center max-w-xl mx-auto mb-8">
        {/*
          The line breaks are deliberate: left to wrap on its own the headline
          strands the last word alone at 375px. The dialect names step down a
          size — they qualify the promise above rather than share its weight.
        */}
        <h1 className="text-t-headline sm:text-t-display text-desert-red mb-3 text-balance">
          إنجليزي محكي حقيقي،
          <br />
          كلمة كلمة.
          <span className="block mt-1 text-t-subtitle sm:text-t-title text-desert-red/70">
            نشرح لك بلهجتك: خليجي · مصري · يمني.
          </span>
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          كل شي هنا إنجليزي، وكل شرح له بلهجتك إنت. دروس، صوت ناطقين أصليين،
          وبطاقات مراجعة متباعدة مبنية من كلام الناس الحقيقي — مو من كتاب.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-10">
        <Button
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/auth")}
        >
          انضم للتجربة — مجاناً
          <ArrowRight className="h-4 w-4 mr-2" />
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-12 text-base"
          onClick={() => navigate("/placement")}
        >
          جرّب اختبار المستوى
        </Button>
      </div>

      {/* Value props — who says it, how it sticks, what you hear next */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto mb-6">
        <ValueCard
          icon={<Headphones className="h-5 w-5" />}
          title="بأصوات ناطقين أصليين"
          body="كل كلمة وجملة مسجّلة بصوت ناطقين بالإنجليزي — فاللي تتعلمه هو نفسه اللي بتسمعه برّا."
        />
        <ValueCard
          icon={<Brain className="h-5 w-5" />}
          title="كل كلمة تثبت معك"
          body="الكلمات ترجع لك بالضبط قبل ما تنساها. مبني على FSRS، وريث SM-2 الحديث."
        />
        <ValueCard
          icon={<PlayCircle className="h-5 w-5" />}
          title="محتوى تتفرّج عليه أصلاً"
          body="تيك توك، مقاطع أخبار، قصص ومحادثات — دوس على أي كلمة تتعلمها وتحفظها."
        />
      </div>

      {/* Secondary nudges */}
      <div className="text-center max-w-md mx-auto">
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Globe2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            درست إنجليزي بالمدرسة؟ نوصّلك من إنجليزي الكتاب إلى الإنجليزي المحكي.
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
