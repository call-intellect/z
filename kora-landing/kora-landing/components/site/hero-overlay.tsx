import Image from "next/image";

/**
 * Hero «один в один»: финальная картинка без заголовка как фон,
 * заголовок и надзаголовок — живой HTML-текст сверху (SEO, чёткость, правка).
 *
 * Адаптив: на телефоне подставляется вертикальная картинка (4:5),
 * на десктопе — широкая (16:9). Размер текста в cqw масштабируется
 * вместе с шириной контейнера.
 */
export function HeroOverlay() {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl [container-type:inline-size] sm:aspect-[16/9]">
      {/* Мобильная картинка */}
      <Image
        src="/hero-mobile.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover sm:hidden"
      />
      {/* Десктопная картинка */}
      <Image
        src="/hero-desktop.png"
        alt=""
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 1024px"
        className="hidden object-cover sm:block"
      />

      {/* Надзаголовок */}
      <p className="absolute left-1/2 top-[3%] -translate-x-1/2 whitespace-nowrap text-center text-[3cqw] font-medium tracking-wide text-slate-600 sm:top-[5.5%] sm:text-[1.7cqw]">
        Прозрейте в своём бизнесе
      </p>

      {/* Заголовок */}
      <h1 className="absolute left-1/2 top-[7%] w-[90%] -translate-x-1/2 text-center text-[4.1cqw] font-extrabold leading-[1.12] tracking-tight sm:top-[10%] sm:w-[72%] sm:text-[3.3cqw]">
        <span className="block text-[var(--kora-blue)]">Запустим оцифровку</span>
        <span className="block text-slate-800">вашего бизнеса и команды за 1 день</span>
      </h1>
    </div>
  );
}
