import { Link, useNavigate } from "react-router-dom";
import { Globe2 } from "lucide-react";
import { IngleezyLogo } from "@/components/brand/IngleezyLogo";
import { Art, type ArtName } from "@/components/brand/Art";
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
 * The first screen is the onboarding design: the wordmark, the two speech
 * bubbles, the promise in the book serif over a soft gold-and-teal wash, and
 * one gradient button. Nothing on it looks "Arab" on purpose (the campfire
 * clip that once sat here told the visitor the app was for them by looking
 * like their heritage); what appeals is the product, shown further down: a
 * real English line, the word they would stop on lit in gold, and its meaning
 * in their own dialect.
 */
export function LandingHero() {
  const navigate = useNavigate();

  return (
    <div className="pb-6">
      <section className="-mx-4 -mt-4 overflow-hidden rounded-b-[32px] bg-wash-hero sm:mx-0 sm:mt-0 sm:rounded-[32px]">
        <div className="mx-auto flex max-w-md flex-col items-center px-6 pb-8 pt-7 text-center">
          <IngleezyLogo className="text-[30px]" />

          <Art name="bubbles" eager className="mt-4 h-[260px] w-[260px] sm:h-[290px] sm:w-[290px]" />

          <span className="mt-1 rounded-full bg-card px-3 py-1 text-[13px] font-semibold leading-5 shadow-soft">
            مقاطع حقيقية · شرح بلهجتك
          </span>

          {/* The line break is deliberate: left to wrap on its own the
              headline strands the last word alone at 375px. */}
          <h1 className="mt-4 text-balance text-[34px] leading-[52px] sm:text-[38px] sm:leading-[58px]">
            إنجليزي محكي حقيقي،
            <br />
            كلمة كلمة.
          </h1>
          <p lang="en" dir="ltr" className="mt-1.5 font-heading text-[15px] italic leading-[22px] text-muted-foreground">
            Real spoken English, word by word.
          </p>

          <button
            type="button"
            onClick={() => navigate("/auth")}
            className="mt-8 flex h-[62px] w-full items-center justify-between rounded-full bg-gradient-cta pe-2 ps-6 text-lg font-semibold shadow-elegant transition-transform active:scale-[0.98]"
          >
            انضم للتجربة — مجاناً
            <span className="grid h-[46px] w-[46px] place-items-center rounded-full bg-card text-foreground">
              <IconNext className="h-[22px] w-[22px]" />
            </span>
          </button>
          <Button asChild variant="outline" className="mt-2.5 h-[54px] w-full text-base">
            <Link to="/auth">عندي حساب</Link>
          </Button>
          <p className="mt-3.5 text-[13px] leading-5 text-muted-foreground">الشرح بالخليجي · المصري · اليمني</p>
        </div>
      </section>

      <DemoCard />

      <div className="mx-auto mt-4 max-w-md text-center">
        <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/placement")}>
          جرّب اختبار المستوى
        </Button>
      </div>

      <p className="mx-auto mb-8 mt-6 max-w-md text-center text-[15px] leading-7 text-muted-foreground">
        كل شي هنا إنجليزي، وكل شرح له بلهجتك إنت. دروس، صوت ناطقين أصليين،
        وبطاقات مراجعة متباعدة مبنية من كلام الناس الحقيقي — مو من كتاب.
      </p>

      {/* Value props — who says it, how it sticks, what you hear next */}
      <div className="mx-auto mb-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        <ValueCard
          art="headphones"
          title="بأصوات ناطقين أصليين"
          body="كل كلمة وجملة مسجّلة بصوت ناطقين بالإنجليزي — فاللي تتعلمه هو نفسه اللي بتسمعه برّا."
        />
        <ValueCard
          art="book"
          title="كل كلمة تثبت معك"
          body="الكلمات ترجع لك بالضبط قبل ما تنساها، بنظام مراجعة متباعدة (FSRS)."
        />
        <ValueCard
          art="coffee"
          title="محتوى تتفرّج عليه أصلاً"
          body="تيك توك، مقاطع أخبار، قصص ومحادثات — دوس على أي كلمة تتعلمها وتحفظها."
        />
      </div>

      <p className="mx-auto flex max-w-md items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
        <Globe2 className="h-3.5 w-3.5 shrink-0" />
        <span>درست إنجليزي بالمدرسة؟ نوصّلك من إنجليزي الكتاب إلى الإنجليزي المحكي.</span>
      </p>
    </div>
  );
}

/**
 * One line from a clip, as the app shows it: the English, the word a learner
 * would stop on highlighted in gold, and the meaning in Gulf Arabic. Static —
 * it is a picture of the product, so nothing on it is a control.
 */
function DemoCard() {
  return (
    <figure
      aria-label="مثال من المقاطع"
      className="relative mx-auto mt-6 max-w-md rounded-[28px] bg-card p-5 shadow-card"
    >
      <span className="inline-block rounded-full bg-tint-firoza px-2.5 py-0.5 text-xs font-semibold leading-[18px] text-primary dark:text-foreground">
        من مقطع حقيقي · خليجي
      </span>
      <p lang="en" className="font-english mt-3 text-[22px] font-semibold leading-9">
        I&apos;m not gonna lie, that was{" "}
        <mark className="rounded-md bg-accent px-1.5 text-accent-foreground">rough</mark>.
      </p>
      <p className="mt-1 text-[15px] leading-7 text-muted-foreground">ما راح أكذب عليك، كانت صعبة.</p>
      <figcaption className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2 text-sm text-foreground">
        <bdi className="font-heading text-base">rough</bdi>
        <span className="text-muted-foreground">=</span>
        <span className="font-naskh text-base">صعبة، متعبة</span>
      </figcaption>
    </figure>
  );
}

function ValueCard({ art, title, body }: { art: ArtName; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-3xl bg-card p-4 shadow-card sm:flex-col">
      <Art name={art} className="h-14 w-14 shrink-0" />
      <div>
        <h3 className="mb-1 text-[15px] font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
