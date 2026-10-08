import { TRIAL_DAYS } from "./pricing";

// The free calculators at /tools. The words here say what each one does and how, in plain language, next to the maths in
// calculators.ts. They are planning aids: no result is a promise, a tax opinion or medical advice, and each page says so.

export const TOOLS_PATH = "/tools";

export type Tool = {
  slug: string;
  audience: "gym" | "fitness";
  /** What links to this tool say. */
  label: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  /** How the answer is worked out, shown on the page. */
  method: readonly string[];
  /** A short caution shown with the result. */
  note: string;
  faq: readonly { q: string; a: string }[];
  /** Where the tool leads: [what the link says, path]. */
  product: readonly [label: string, href: string];
};

export const toolPath = (t: Pick<Tool, "slug">) => `${TOOLS_PATH}/${t.slug}`;

const GYM_NOTE = "A planning estimate from the numbers you enter, not accounting or tax advice. Confirm what applies to your gym with your accountant.";
const BODY_NOTE = "General fitness guidance, not medical advice. If you have a health condition, are pregnant or take medicines, ask a doctor or dietitian first.";
const GYM_PRODUCT = ["See how FITRON Gym Accounting keeps these numbers for you", "/gym-accounting"] as const;
const TRAINER_PRODUCT = ["Get a plan built around your numbers with the FITRON AI Trainer", "/ai-personal-trainer"] as const;

export const TOOLS: readonly Tool[] = [
  {
    slug: "gym-profit-calculator",
    audience: "gym",
    label: "Gym profit calculator",
    title: "Gym Profit Calculator: Monthly Profit and Margin | FITRON",
    description: "Work out your gym's monthly profit, margin and break-even members from your fees and costs, with GST taken out of your revenue. Free, no sign-up.",
    h1: "Gym profit calculator",
    intro: "Enter your members, fees and monthly costs to see what your gym really earns each month, your margin, the profit on each member and how many members you need to cover your costs.",
    method: [
      "Revenue = members × average monthly fee + other income. If your fees include GST, the GST is taken out first, because the tax you collect is not your income.",
      "Costs = rent + salaries + utilities + marketing + equipment upkeep + other costs, per month.",
      "Profit = revenue − costs. Margin = profit ÷ revenue. Profit per member = profit ÷ members.",
      "Break-even members = (costs − other income) ÷ the fee per member, rounded up.",
    ],
    note: GYM_NOTE,
    faq: [
      { q: "Should I enter fees with or without GST?", a: "Either. Say which with the tick box and the calculator works with the fee without GST, which is what the gym actually earns." },
      { q: "Does this include depreciation of equipment?", a: "No. Add a monthly amount for equipment replacement under equipment upkeep if you want to plan for it. FITRON Gym Accounting records depreciation on fixed assets in the profit and loss." },
      { q: "Why is my real profit different?", a: "Real months have late payers, discounts, one-off bills and members who joined mid-month. Use this to plan, and your books for the truth." },
    ],
    product: GYM_PRODUCT,
  },
  {
    slug: "gym-membership-revenue-calculator",
    audience: "gym",
    label: "Gym membership revenue calculator",
    title: "Gym Membership Revenue Calculator: Monthly and Yearly | FITRON",
    description: "Turn your monthly, quarterly, half-yearly and annual membership plans into one monthly and yearly revenue figure, and see which plan earns the most.",
    h1: "Gym membership revenue calculator",
    intro: "Members pay for different periods, so cash in the bank is not the same as monthly revenue. Enter how many members are on each plan and its price to see revenue per month and per year.",
    method: [
      "Each plan's monthly value = members × price ÷ the months the plan covers.",
      "Monthly revenue is the total of those values, and yearly revenue is that × 12.",
      "The share column shows how much of the monthly revenue each plan brings in.",
      "Prices are what members pay (include GST if you charge it that way); GST is not separated here. Use the GST calculator for that.",
    ],
    note: GYM_NOTE,
    faq: [
      { q: "Why divide a yearly plan by 12?", a: "A member who pays ₹9,600 for twelve months is worth ₹800 a month to the gym. Counting the whole payment in one month makes some months look rich and others poor." },
      { q: "Does this predict next year's revenue?", a: "No. It shows what the members you have today are worth. Members leave and join, which the churn calculator looks at." },
    ],
    product: GYM_PRODUCT,
  },
  {
    slug: "gym-break-even-calculator",
    audience: "gym",
    label: "Gym break-even calculator",
    title: "Gym Break-Even Calculator: Members Needed to Cover Costs | FITRON",
    description: "Find how many members your gym needs to cover its fixed costs, the revenue that takes, and how many months to earn back your set-up investment.",
    h1: "Gym break-even calculator",
    intro: "Your break-even point is the number of members at which the gym stops losing money. Enter your fixed costs, your fee and what each member costs you to serve.",
    method: [
      "Left from each member = fee per member (without GST) − the cost of serving that member.",
      "Members needed = fixed costs ÷ what is left from each member, rounded up.",
      "Revenue needed = members needed × the fee per member.",
      "Monthly profit now = current members × what is left from each member − fixed costs. Payback months = set-up investment ÷ monthly profit now, if it is positive.",
    ],
    note: GYM_NOTE,
    faq: [
      { q: "What are fixed costs?", a: "Costs that do not change with the number of members: rent, salaries, loan repayments, insurance and most electricity. Costs that rise with each member, such as a towel service, go under cost per member." },
      { q: "What if a member costs more than they pay?", a: "Then there is no break-even: every new member adds to the loss. The calculator says so instead of giving a number." },
    ],
    product: GYM_PRODUCT,
  },
  {
    slug: "gst-calculator-for-gym-memberships",
    audience: "gym",
    label: "GST calculator for gym memberships",
    title: "GST Calculator for Gym Memberships: CGST, SGST, IGST | FITRON",
    description: "Add GST to a gym membership price, or take it out of one that includes GST, and see the CGST and SGST split or the IGST for a sale to another state.",
    h1: "GST calculator for gym memberships",
    intro: "Enter a membership price and choose whether it already includes GST. You get the price before tax, the tax, the CGST and SGST halves (or IGST), and the total, to the paisa.",
    method: [
      "Price without GST: the tax is the rate % of it, and the total is the two together.",
      "Price with GST: the price before tax is the total × 100 ÷ (100 + rate), and the tax is what is left. This is how FITRON's invoices split a price that includes GST.",
      "A sale inside your state is split into CGST and SGST halves (an odd paisa goes to SGST); a sale to another state is charged as IGST.",
      "The rate starts at 18%, the rate commonly applied to gym and fitness services. Check the rate and whether your gym must register with your accountant.",
    ],
    note: "General information, not tax advice. GST rules, rates and registration limits change; confirm what applies to your gym with your accountant.",
    faq: [
      { q: "What GST rate applies to a gym membership?", a: "Fitness and gym services are commonly charged 18%. Rates are set by the government and can change, so check the current rate with your accountant." },
      { q: "Does FITRON do this on its invoices?", a: "Yes. When GST is switched on in Settings, every invoice shows your GSTIN and the CGST and SGST split (or IGST) at the rate you set, and the GST invoice register lists them for your accountant." },
    ],
    product: ["See GST invoices in FITRON Gym Accounting", "/gym-gst-billing"],
  },
  {
    slug: "gym-churn-calculator",
    audience: "gym",
    label: "Gym churn calculator",
    title: "Gym Member Churn Calculator: Retention and Lifetime | FITRON",
    description: "Work out your gym's member churn and retention rate, how long the average member stays and how much monthly revenue the members you lose take with them.",
    h1: "Gym churn calculator",
    intro: "Churn is the share of members who leave. Enter the members you started the period with, how many you lost and how many joined, and see what it costs you.",
    method: [
      "Churn for the period = members lost ÷ members at the start. New joiners are not counted: they were not there to leave.",
      "Retention = 100% − churn.",
      "Monthly churn: for a period longer than a month, the rate that, repeated each month, gives the same loss over the period.",
      "Average member lifetime = 1 ÷ monthly churn, in months. Revenue lost each month = members lost per month × the average fee.",
    ],
    note: GYM_NOTE,
    faq: [
      { q: "What is a good churn rate for a gym?", a: "It depends on the gym, the city and the season, and there is no single right figure. Track your own over several months and aim to bring it down." },
      { q: "How can I reduce churn?", a: "Notice who has stopped coming before their renewal date, and reach out. FITRON Gym Accounting's renewals list and attendance show who is slipping, and WhatsApp reminders help the follow-up." },
    ],
    product: ["See renewals and reminders in FITRON Gym Accounting", "/gym-management-software"],
  },
  {
    slug: "gym-pricing-calculator",
    audience: "gym",
    label: "Gym pricing calculator",
    title: "Gym Pricing Calculator: Membership Fees and Plan Prices | FITRON",
    description: "Find the monthly membership fee your gym needs to cover its costs and reach a profit target, then price 3, 6 and 12-month plans with GST and discounts.",
    h1: "Gym pricing calculator",
    intro: "Start from what the gym costs and what you want to earn, and work back to the fee. Then set a discount for longer plans and see their prices with GST.",
    method: [
      "Fee without GST = (monthly costs + target profit) ÷ the members you expect to have.",
      "Fee with GST = that × (1 + GST rate). Plan price = fee with GST × months × (1 − the discount for that plan).",
      "Prices are rounded to the nearest rupee.",
      "Longer-plan discounts lower your average fee. If many members will take them, raise the monthly fee or expect fewer rupees per member.",
    ],
    note: GYM_NOTE,
    faq: [
      { q: "Which members should I count?", a: "Count members you are confident of keeping, not your best month. A fee based on too many members will not cover costs." },
      { q: "Is the price I should charge the same as this?", a: "It is the price that works for your costs. What members in your area will pay matters too: check nearby gyms before you decide." },
    ],
    product: ["Set up your plans and prices in FITRON Gym Accounting", "/gym-accounting"],
  },
  {
    slug: "protein-calculator",
    audience: "fitness",
    label: "Protein calculator",
    title: "Protein Calculator: Daily Protein Target in Grams | FITRON",
    description: "Find a daily protein range in grams from your body weight and your goal, and how much to eat at each meal. A free planning tool, not medical advice.",
    h1: "Protein calculator",
    intro: "Enter your weight and what you are training for to get a daily protein range in grams and a per-meal amount. Dal, curd, paneer, eggs, chicken and fish all count.",
    method: [
      "Protein per kilo of body weight by goal: about 0.8 to 1.0 g if you train little, 1.2 to 1.6 g for general fitness, 1.6 to 2.0 g to build muscle, and 1.6 to 2.2 g to lose fat while keeping muscle.",
      "Daily range = your weight × those figures, rounded to the nearest gram.",
      "Per meal = the range ÷ the number of meals you eat.",
      "These are planning ranges used for healthy adults who exercise. They are not a prescription.",
    ],
    note: BODY_NOTE,
    faq: [
      { q: "Do I need protein powder?", a: "No. A range in grams can come from ordinary Indian food. Powder is only a convenient way to fill a gap." },
      { q: "Is more protein better?", a: "Past the top of the range there is little extra benefit for most people. Anyone with kidney disease or another condition should ask a doctor before raising protein." },
    ],
    product: TRAINER_PRODUCT,
  },
  {
    slug: "calorie-calculator",
    audience: "fitness",
    label: "Calorie calculator",
    title: "Calorie Calculator: Daily Calories to Lose, Keep or Gain | FITRON",
    description: "Estimate your daily calorie needs from your age, height, weight and activity, and a target to lose fat, stay the same or gain muscle. Free, not medical advice.",
    h1: "Calorie calculator",
    intro: "Enter your age, height, weight and how active you are to get an estimate of the calories you burn in a day, and a target for your goal.",
    method: [
      "Resting energy uses the Mifflin-St Jeor equation: 10 × weight (kg) + 6.25 × height (cm) − 5 × age, then + 5 for the male formula or − 161 for the female formula.",
      "Daily calories to stay the same = resting energy × an activity factor from 1.2 (little exercise) to 1.9 (very hard exercise or a physical job).",
      "Target = that, minus 500 to lose fat, or plus 300 to gain muscle. A 500 kcal gap is a common starting point and is not a promise of a rate of loss.",
      "It is an estimate: two people with the same numbers can differ by a few hundred calories.",
    ],
    note: BODY_NOTE,
    faq: [
      { q: "Why male and female formulas?", a: "The equation was fitted separately for each, so the calculator asks which to use. It does not change anything else." },
      { q: "Is eating less always better for fat loss?", a: "No. A target below about 1,200 kcal for women or 1,500 for men should only be followed with a doctor or dietitian. The calculator warns you when your target is that low." },
    ],
    product: TRAINER_PRODUCT,
  },
];

export const findTool = (slug: string) => TOOLS.find((t) => t.slug === slug);
export const trialLine = `${TRIAL_DAYS}-day free trial`;
