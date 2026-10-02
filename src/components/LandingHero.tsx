import { useNavigate } from "react-router-dom";
import { IngleezyLogo } from "@/components/brand/IngleezyLogo";
import { Headphones, Brain, PlayCircle, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconNext } from "@/components/shared/DirectionalIcon";

/**
 * Logged-out landing hero shown on `/` when the visitor isn't authenticated.
 * Goal: explain Ingleezy in one screen and push to /auth or /placement.
 *
 * The framing is the name. إنجليزي is what an Arabic speaker already calls the
 * language — not "English as a Foreign Language", just the thing everyone is
 * trying to speak. So the promise is spoken English rather than exam English,
 * and it is made in the visitor's own language.
 *
 * The picture is the product rather than a scene. The campfire clip that sat
 * here (men round a fire in the dunes, a camel behind them) was heritage
 * ornament carried over from Hakiya; it told an Arabic speaker the app was
 * "for them" by looking Arab, which is the one thing the brand has decided
 * not to do. What appeals instead is the thing they came for: a real English
 * line, the word they would get stuck on lit in gold, and its meaning in
 * their own dialect underneath.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <section className="py-6">
      <div className="mb-6 flex justify-center">
        <IngleezyLogo className="text-3xl sm:text-4xl" />
      </div>

      <div className="mx-auto mb-6 max-w-xl text-center">
        {/*
          The line breaks are deliberate: left to wrap on its own the headline
          strands the last word alone at 375px. The dialect names step down a
          size — they qualify the promise above rather than share its weight.
        */}
        <h1 className="mb-3 text-balance text-t-headline text-foreground sm:text-t-display">
          إنجليزي محكي حقيقي،
          <br />
          <span className="text-primary">كلمة كلمة.</span>
          <span className="mt-1 block text-t-subtitle text-muted-foreground sm:text-t-title">
            نشرح لك بلهجتك: خليجي · مصري · يمني.
          </span>
        </h1>
      </div>

      <DemoCard />

      {/* flex-1 only in a row: in the stacked column it sets a zero basis,
          which overrides the height and collapses the buttons to their text. */}
      <div className="mx-auto mb-4 mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
        <Button size="lg" className="h-14 text-base sm:flex-1" onClick={() => navigate("/auth")}>
          انضم للتجربة — مجاناً
          <IconNext className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="lg" className="h-14 text-base sm:flex-1" onClick={() => navigate("/placement")}>
          جرّب اختبار المستوى
        </Button>
      </div>

      <p className="mx-auto mb-10 max-w-md text-center text-[15px] leading-7 text-muted-foreground">
        كل شي هنا إنجليزي، وكل شرح له بلهجتك إنت. دروس، صوت ناطقين أصليين،
        وبطاقات مراجعة متباعدة مبنية من كلام الناس الحقيقي — مو من كتاب.
      </p>

      {/* Value props — who says it, how it sticks, what you hear next */}
      <div className="mx-auto mb-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        <ValueCard
          icon={<Headphones className="h-5 w-5" />}
          title="بأصوات ناطقين أصليين"
          body="كل كلمة وجملة مسجّلة بصوت ناطقين بالإنجليزي — فاللي تتعلمه هو نفسه اللي بتسمعه برّا."
        />
        <ValueCard
          icon={<Brain className="h-5 w-5" />}
          title="كل كلمة تثبت معك"
          body="الكلمات ترجع لك بالضبط قبل ما تنساها، بنظام مراجعة متباعدة (FSRS)."
        />
        <ValueCard
          icon={<PlayCircle className="h-5 w-5" />}
          title="محتوى تتفرّج عليه أصلاً"
          body="تيك توك، مقاطع أخبار، قصص ومحادثات — دوس على أي كلمة تتعلمها وتحفظها."
        />
      </div>

      <p className="mx-auto flex max-w-md items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
        <Globe2 className="h-3.5 w-3.5 shrink-0" />
        <span>درست إنجليزي بالمدرسة؟ نوصّلك من إنجليزي الكتاب إلى الإنجليزي المحكي.</span>
      </p>
    </section>
  );
}

/**
 * One line from a clip, as the app shows it: the English, the word a learner
 * would stop on highlighted, and the meaning in Gulf Arabic. Static — it is a
 * picture of the product, so nothing on it is a control.
 */
function DemoCard() {
  return (
    <figure
      aria-label="مثال من المقاطع"
      className="relative mx-auto max-w-md overflow-hidden rounded-[28px] bg-primary p-6 text-primary-foreground shadow-card"
    >
      <span aria-hidden className="absolute -bottom-16 -start-12 h-40 w-40 rounded-full bg-black/10" />
      <div className="relative">
        <p className="mb-3 text-[13px] font-medium text-primary-foreground/80">من مقطع حقيقي · خليجي</p>
        <p lang="en" className="font-english text-[26px] font-bold leading-9">
          I&apos;m not gonna lie, that was{" "}
          <mark className="rounded-lg bg-accent px-1.5 text-accent-foreground">rough</mark>.
        </p>
        <p className="mt-2 text-base leading-7 text-primary-foreground/85">ما راح أكذب عليك، كانت صعبة.</p>
        <figcaption className="mt-4 inline-flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-sm text-foreground">
          <bdi className="font-english font-bold">rough</bdi>
          <span className="text-muted-foreground">=</span>
          <span className="font-semibold">صعبة، متعبة</span>
        </figcaption>
      </div>
    </figure>
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
    <div className="rounded-3xl bg-card p-4 shadow-card">
      <div className="mb-2.5 grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mb-1 text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
