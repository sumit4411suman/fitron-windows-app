import { Logo } from "@/components/logo";
import { ABOUT } from "@/lib/domain/about";
import { CookieSettingsButton } from "./site-consent";

// The footer of every public page, in the same five columns as the home page's.
const columns = [
  [
    "Products",
    [
      ["/ai-personal-trainer", "AI Trainer"],
      ["/gym-accounting", "Gym Accounting"],
      ["/gym-management-software", "Gym Management"],
      ["/gym-gst-billing", "GST Billing"],
    ],
  ],
  [
    "Business",
    [
      ["/#partnership", "Partner With Us"],
      ["/#pricing", "Pricing"],
      ["/contact", "Contact"],
      ["/guides", "Guides"],
      ["/tools", "Free tools"],
    ],
  ],
  [
    "Company",
    [
      ["/about", "About"],
      ["/#together", "Better Together"],
      ["/#faq", "FAQ"],
      ["/contact", "Contact"],
      ["/contact#company", "Company details"],
    ],
  ],
] as const;

const legal = [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms & Conditions"],
  ["/refund", "Refund Policy"],
  ["/terms#partners", "Gym Partner & Customer Policy"],
  ["/privacy#cookies", "Cookie Policy"],
  ["/privacy#rights", "DPDP Rights"],
  ["/privacy#grievance", "Grievance Officer"],
] as const;

const link = "text-sm text-muted no-underline hover:text-accent";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl gap-x-8 gap-y-10 px-4 py-12 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="sm:col-span-3 lg:col-span-1">
          <a href="/" aria-label="FITRON home">
            <Logo size={34} priority={false} />
          </a>
          <p className="mt-4 max-w-xs text-sm text-muted">Your AI personal trainer and gym management platform, built for India.</p>
          <p className="mt-4 flex flex-col gap-1.5 text-sm">
            <a href="https://wa.me/916207774673" target="_blank" rel="noopener" data-track="whatsapp_click" data-track-from="footer" className={link}>
              WhatsApp +91 62077 74673
            </a>
            <a href="mailto:hello@fitron.in" data-track="email_click" data-track-from="footer" className={link}>
              hello@fitron.in
            </a>
            <span className="text-muted">Mon–Sat, 10 am to 6 pm IST</span>
          </p>
          {ABOUT.social.length > 0 && (
            <ul aria-label="FITRON on social media" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {ABOUT.social.map((x) => (
                <li key={x.url}>
                  <a href={x.url} rel="me noopener" target="_blank" className={link}>
                    {x.network}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {columns.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="mb-3 text-xs font-bold tracking-[0.14em] uppercase">{title}</p>
            <ul className="flex flex-col gap-2.5">
              {links.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className={link}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <nav aria-label="Legal">
          <p className="mb-3 text-xs font-bold tracking-[0.14em] uppercase">Legal</p>
          <ul className="flex flex-col gap-2.5">
            {legal.map(([href, label]) => (
              <li key={href}>
                <a href={href} className={link}>
                  {label}
                </a>
              </li>
            ))}
            <li>
              <CookieSettingsButton className={link} />
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted">© 2026 FITRON. Compliant with the Digital Personal Data Protection Act, 2023.</p>
      </div>
    </footer>
  );
}
